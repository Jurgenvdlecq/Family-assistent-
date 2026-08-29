/**
 * Integratietest tegen een echte (lokale) Postgres: welke producten mag de
 * boodschappenlijst überhaupt kiezen?
 *
 * Sinds de prijslaag staan de producten van Albert Heijn en Dirk in dezelfde
 * `Product`-tabel als die van Picnic. Ze zijn er om mee te vergelijken —
 * bestellen gaat en blijft via Picnic. Deze test legt vast dat de matcher ze
 * daarom nooit op een boodschappenregel zet, want zo'n regel heeft geen
 * Picnic-id: hij zou stilzwijgend niet meegaan naar het mandje, en het juiste
 * product hebben verdrongen.
 *
 * Een echte database is hier het punt: het gaat om de query die de kandidaten
 * ophaalt, en dat is precies wat een gemockte Prisma-laag zou wegpoetsen.
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { ensureShoppingList } from "./shoppingList";
import { getBasketOverview } from "./pricing/basket";
import { getCurrentWeekStart } from "./week";

async function makeFixture(label: string) {
  const household = await prisma.household.create({
    data: { name: label, persons: { create: [{ name: "Test", role: "PARENT" }] } },
  });
  const ingredient = await prisma.ingredient.create({
    data: { name: `${label} ingrediënt ${household.id}`, unit: "PIECE", category: "OTHER" },
  });
  const recipe = await prisma.recipe.create({
    data: {
      title: `${label} gerecht ${household.id}`,
      category: "OTHER",
      ingredients: { create: [{ ingredientId: ingredient.id, quantity: 1, unit: "PIECE" }] },
      variants: { create: [{ variantType: "FAST" }] },
    },
    include: { variants: true },
  });
  const mealPlan = await prisma.mealPlan.create({
    data: {
      householdId: household.id,
      weekStart: getCurrentWeekStart(),
      status: "CONFIRMED",
      entries: {
        create: [
          { dayOfWeek: "MONDAY", recipeVariantId: recipe.variants[0].id, includedInGroceries: true },
        ],
      },
    },
  });
  return { household, ingredient, mealPlan };
}

async function cleanup(householdId: string) {
  await prisma.shoppingList.deleteMany({ where: { mealPlan: { householdId } } });
  await prisma.mealPlan.deleteMany({ where: { householdId } });
  await prisma.product.deleteMany({ where: { externalRef: { contains: householdId } } });
  await prisma.recipe.deleteMany({ where: { title: { contains: householdId } } });
  await prisma.ingredient.deleteMany({ where: { name: { contains: householdId } } });
  await prisma.person.deleteMany({ where: { householdId } });
  await prisma.household.delete({ where: { id: householdId } });
}

test("boodschappenlijst: een winkelproduct van Albert Heijn komt nooit op een regel", async () => {
  const { household, ingredient, mealPlan } = await makeFixture("Winkelproduct");
  try {
    // Alleen een AH-product voor dit ingrediënt — verder niets. Vóór de
    // afbakening koos de matcher dit gewoon, en dan stond er een regel op de
    // lijst die nooit besteld kan worden.
    await prisma.product.create({
      data: {
        name: "AH Testproduct",
        provider: "AH",
        externalRef: `ah-test-${household.id}`,
        ingredientId: ingredient.id,
        lastSeenAvailable: new Date(),
      },
    });

    const list = await ensureShoppingList(mealPlan.id, household.id);
    const line = list.lines.find((candidate) => candidate.ingredientId === ingredient.id);
    assert.ok(line, "de regel hoort er gewoon te staan");
    assert.equal(line.productId, null, "maar zonder product — een AH-artikel gaat niet naar Picnic");
  } finally {
    await cleanup(household.id);
  }
});

test("boodschappenlijst: naast een AH-product wint het Picnic-product", async () => {
  const { household, ingredient, mealPlan } = await makeFixture("Twee winkels");
  try {
    const picnicProduct = await prisma.product.create({
      data: {
        name: "Picnic Testproduct",
        provider: "PICNIC",
        externalRef: `picnic-test-${household.id}`,
        ingredientId: ingredient.id,
        lastSeenAvailable: new Date(),
      },
    });
    // Bewust met een bekende verpakkingsgrootte, en het Picnic-product zonder:
    // dan wint dit AH-product de afweging bij élke productvoorkeur. Een
    // AH-product ís meestal zo'n geval, want Albert Heijn levert de inhoud
    // gewoon mee. Zonder het providerfilter komt dit product dus op de regel —
    // dat is wat deze test moet aantonen.
    await prisma.product.create({
      data: {
        name: "AH Testproduct",
        provider: "AH",
        externalRef: `ah-test-${household.id}`,
        ingredientId: ingredient.id,
        packageQuantity: 500,
        lastSeenAvailable: new Date(),
      },
    });

    const list = await ensureShoppingList(mealPlan.id, household.id);
    const line = list.lines.find((candidate) => candidate.ingredientId === ingredient.id);
    assert.equal(line?.productId, picnicProduct.id);
    // En het AH-product duwt de regel ook niet naar de twijfelstapel: het
    // hoort geen kandidaat te zijn, niet een afgewezen kandidaat.
    assert.equal(line?.matchStatus, "MATCHED_TRUSTED");
    assert.equal(line?.needsReview, false);
  } finally {
    await cleanup(household.id);
  }
});

/**
 * De Alpro-regressie (gebruikersmelding met schermafbeelding: "€ 6.181,74").
 *
 * Drie pakken Alpro van 750 gram werden bij Albert Heijn 563 verpakkingen.
 * De oorzaak zat niet in het omrekenen maar in de eenheid: de inhoud van een
 * winkelverpakking wordt gelezen uit de tekst ("4 stuks"), maar de eenheid
 * daarvan werd weggegooid en vervangen door die van het ingrediënt (GRAM).
 * Daardoor leken "4 stuks" en "750 gram" in dezelfde eenheid te staan en werd
 * 2250 gram gedeeld door 4 — 563 verpakkingen à € 10,98.
 *
 * De opzet volgt de productiesituatie precies: een vaste boodschap in stuks
 * ("3x"), op een ingrediënt dat in grammen wordt bijgehouden.
 */
test("mandje: een verpakking in stuks wordt niet afgerekend tegen een verpakking in grammen", async () => {
  const household = await prisma.household.create({
    data: { name: "Alpro-regressie", persons: { create: [{ name: "Test", role: "PARENT" }] } },
  });
  try {
    const ingredient = await prisma.ingredient.create({
      data: { name: `Alpro ${household.id}`, unit: "GRAM", category: "OTHER" },
    });
    const picnicProduct = await prisma.product.create({
      data: {
        name: `Alpro mild & creamy ${household.id}`,
        provider: "PICNIC",
        externalRef: `picnic-test-${household.id}`,
        ingredientId: ingredient.id,
        packageSize: "750 gram",
        packageQuantity: 750,
        price: 2.99,
        lastSeenAvailable: new Date(),
      },
    });
    const ahProduct = await prisma.product.create({
      data: {
        name: `Alpro Barista koffiemelk ${household.id}`,
        provider: "AH",
        externalRef: `ah-test-${household.id}`,
        ingredientId: ingredient.id,
        packageSize: "4 stuks",
        packageQuantity: 4,
        price: 10.98,
        lastSeenAvailable: new Date(),
      },
    });
    await prisma.priceObservation.create({
      data: { productId: ahProduct.id, price: 10.98, promoType: "GEEN", source: "API" },
    });

    const mealPlan = await prisma.mealPlan.create({
      data: { householdId: household.id, weekStart: getCurrentWeekStart(), status: "CONFIRMED" },
    });
    await prisma.shoppingList.create({
      data: {
        mealPlanId: mealPlan.id,
        lines: {
          create: [
            {
              ingredientId: ingredient.id,
              productId: picnicProduct.id,
              // "3x" is hier een aantal verpakkingen, geen hoeveelheid — net
              // als bij een vaste boodschap in productie.
              quantity: 3,
              unit: "PIECE",
              source: "FIXED",
              matchStatus: "MATCHED_TRUSTED",
              matchConfidence: 1,
            },
          ],
        },
      },
    });

    const overview = await getBasketOverview(household.id, mealPlan.id);
    const line = overview.comparison.lines[0];
    assert.ok(line, "de regel hoort doorgerekend te zijn");
    assert.equal(line.referenceCost, 8.97, "onze eigen kant klopt: 3 x € 2,99");

    const ah = line.stores.get("AH");
    assert.notEqual(ah?.cost, 6181.74, "dit is het bedrag uit de melding");
    assert.equal(ah?.cost, null, "zonder vergelijkbare verpakking hoort er geen bedrag te staan");
    assert.equal(ah?.missingReason, "verpakking in stuks, die van ons in gram");
  } finally {
    await prisma.shoppingList.deleteMany({ where: { mealPlan: { householdId: household.id } } });
    await prisma.mealPlan.deleteMany({ where: { householdId: household.id } });
    await prisma.priceObservation.deleteMany({
      where: { product: { externalRef: { contains: household.id } } },
    });
    await prisma.product.deleteMany({ where: { externalRef: { contains: household.id } } });
    await prisma.ingredient.deleteMany({ where: { name: { contains: household.id } } });
    await prisma.person.deleteMany({ where: { householdId: household.id } });
    await prisma.household.delete({ where: { id: household.id } });
  }
});
