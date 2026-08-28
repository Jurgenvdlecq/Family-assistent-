/**
 * Integratietest tegen een echte (lokale) Postgres: boodschappen die je
 * ergens anders haalt of zelf regelt.
 *
 * De kern: zo'n product blijft gewoon op de lijst staan (je moet het immers
 * nog hebben), maar gaat níét mee naar het Picnic-mandje. Alleen die twee
 * dingen samen zijn juist — één van beide weglaten betekent ofwel een
 * vergeten boodschap, ofwel iets in je mandje dat je daar nooit wilde.
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { ensureMealPlan } from "./mealPlan";
import { ensureShoppingList, invalidateShoppingList } from "./shoppingList";
import { addShoppingListToPicnicCart } from "./picnic/cartService";
import { getCurrentWeekStart } from "./week";

function fakePicnicFetch(callLog: string[]) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    callLog.push(url);
    return new Response(JSON.stringify({}), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

async function cleanup(householdId: string) {
  await prisma.householdIngredientFulfillment.deleteMany({ where: { householdId } });
  await prisma.householdProductPreference.deleteMany({ where: { householdId } });
  await prisma.shoppingList.deleteMany({ where: { mealPlan: { householdId } } });
  await prisma.mealPlan.deleteMany({ where: { householdId } });
  await prisma.mealSuggestion.deleteMany({ where: { householdId } });
  await prisma.feedbackEvent.deleteMany({ where: { householdId } });
  await prisma.fixedGrocery.deleteMany({ where: { householdId } });
  await prisma.preference.deleteMany({ where: { ownerId: householdId } });
  await prisma.person.deleteMany({ where: { householdId } });
  await prisma.household.delete({ where: { id: householdId } });
}

/** Een huishouden met één vaste boodschap, zodat er gegarandeerd een regel is. */
async function makeHouseholdWithFixedGrocery(name: string) {
  const ingredient = await prisma.ingredient.findUniqueOrThrow({ where: { name: "Melk" } });
  const household = await prisma.household.create({
    data: {
      name,
      picnicAuthToken: "test-token",
      persons: { create: [{ name: "Test", role: "PARENT" }] },
      fixedGroceries: { create: [{ ingredientId: ingredient.id, quantity: 1, unit: "PIECE" }] },
    },
  });
  return { household, ingredient };
}

test("herkomst: een ingrediënt dat je zelf haalt komt wél op de lijst, maar met een andere herkomst", async () => {
  const { household, ingredient } = await makeHouseholdWithFixedGrocery("Herkomst — op de lijst");
  try {
    await prisma.householdIngredientFulfillment.create({
      data: { householdId: household.id, ingredientId: ingredient.id, fulfillment: "OTHER_STORE" },
    });

    const mealPlan = await ensureMealPlan(household.id, getCurrentWeekStart());
    const list = await ensureShoppingList(mealPlan!.id, household.id);
    const line = list.lines.find((candidate) => candidate.ingredientId === ingredient.id);

    assert.ok(line, "het product hoort gewoon op de lijst te staan — je moet het nog steeds halen");
    assert.equal(line!.fulfillment, "OTHER_STORE");
  } finally {
    await cleanup(household.id);
  }
});

test("herkomst: een regel die je zelf haalt gaat niet mee naar het Picnic-mandje", async () => {
  const { household, ingredient } = await makeHouseholdWithFixedGrocery("Herkomst — niet naar Picnic");
  const originalFetch = globalThis.fetch;
  const callLog: string[] = [];
  try {
    const product = await prisma.product.create({
      data: {
        name: "Testmelk",
        externalRef: `picnic-fulfillment-${household.id}`,
        ingredientId: ingredient.id,
      },
    });
    // Bewust een bevestigde productkeuze: zonder die keuze zou de app dit
    // product sowieso niet bestellen, en dan zou deze test slagen om de
    // verkeerde reden. Nu is er maar één verklaring als er niets wordt
    // toegevoegd — de herkomst.
    await prisma.householdProductPreference.create({
      data: {
        householdId: household.id,
        ingredientId: ingredient.id,
        productId: product.id,
        source: "MANUAL",
      },
    });
    await prisma.householdIngredientFulfillment.create({
      data: { householdId: household.id, ingredientId: ingredient.id, fulfillment: "SELF_PROVIDED" },
    });

    const mealPlan = await ensureMealPlan(household.id, getCurrentWeekStart());
    await invalidateShoppingList(mealPlan!.id);
    const list = await ensureShoppingList(mealPlan!.id, household.id);
    const line = list.lines.find((candidate) => candidate.ingredientId === ingredient.id)!;
    assert.equal(line.fulfillment, "SELF_PROVIDED", "testopzet");
    assert.equal(line.productId, product.id, "testopzet: er ís een bevestigd product, dus bestellen kán");

    globalThis.fetch = fakePicnicFetch(callLog);
    const result = await addShoppingListToPicnicCart(list.id);

    assert.equal(result.added.length, 0, "dit product hoort niet in het Picnic-mandje te belanden");
    assert.equal(
      callLog.filter((url) => url.includes("/cart/add_product")).length,
      0,
      "er hoort geen enkele toevoeg-aanroep naar Picnic te gaan"
    );

    const afterwards = await prisma.shoppingListLine.findUniqueOrThrow({ where: { id: line.id } });
    assert.equal(
      afterwards.transferredToPicnicAt,
      null,
      "en de regel mag ook niet als 'ligt al in je mandje' gemarkeerd worden"
    );
  } finally {
    globalThis.fetch = originalFetch;
    await cleanup(household.id);
  }
});

test("herkomst: naast een zelf-te-halen product gaan de gewone producten gewoon wél mee", async () => {
  // Het verschil met "de hele bestelling blokkeren": één afwijkend product
  // mag de rest van de boodschappen niet tegenhouden.
  const { household, ingredient } = await makeHouseholdWithFixedGrocery("Herkomst — de rest gaat wel mee");
  const originalFetch = globalThis.fetch;
  const callLog: string[] = [];
  try {
    const other = await prisma.ingredient.findUniqueOrThrow({ where: { name: "Brood" } });
    await prisma.fixedGrocery.create({
      data: { householdId: household.id, ingredientId: other.id, quantity: 1, unit: "PIECE" },
    });
    for (const [name, ingredientId] of [
      ["Testmelk", ingredient.id],
      ["Testbrood", other.id],
    ] as const) {
      const product = await prisma.product.create({
        data: { name, externalRef: `picnic-mixed-${name}-${household.id}`, ingredientId },
      });
      // Een bevestigde productkeuze, anders weigert de app het product
      // terecht: zonder vertrouwde keuze bestelt ze niets uit zichzelf.
      await prisma.householdProductPreference.create({
        data: { householdId: household.id, ingredientId, productId: product.id, source: "MANUAL" },
      });
    }
    await prisma.householdIngredientFulfillment.create({
      data: { householdId: household.id, ingredientId: ingredient.id, fulfillment: "OTHER_STORE" },
    });

    const mealPlan = await ensureMealPlan(household.id, getCurrentWeekStart());
    await invalidateShoppingList(mealPlan!.id);
    const list = await ensureShoppingList(mealPlan!.id, household.id);

    globalThis.fetch = fakePicnicFetch(callLog);
    const result = await addShoppingListToPicnicCart(list.id);
    assert.equal(result.added.length, 1, "het brood hoort gewoon in het mandje te komen");
    assert.equal(result.added[0].ingredientName, "Brood");
  } finally {
    globalThis.fetch = originalFetch;
    await cleanup(household.id);
  }
});
