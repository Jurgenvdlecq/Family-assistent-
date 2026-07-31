/**
 * Integratietest tegen een echte (lokale) Postgres — de wisselwerking
 * tussen voorraadstatus en de boodschappenlijst is precies het risico dat
 * een mock zou wegpoetsen (Fase 15).
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { ensureShoppingList, syncShoppingListForInventoryChange } from "./shoppingList";
import { setInventoryStatus, getInventoryChecklist, needsInventoryAttention } from "./inventory";
import { getCurrentWeekStart } from "./week";

test("needsInventoryAttention: nog nooit ingevuld vraagt altijd om aandacht", () => {
  assert.equal(needsInventoryAttention("UNKNOWN", null), true);
});

test("needsInventoryAttention: bijna op / op blijft altijd om aandacht vragen, ongeacht leeftijd", () => {
  const gisteren = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const langGeleden = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
  assert.equal(needsInventoryAttention("LOW", gisteren), true);
  assert.equal(needsInventoryAttention("OUT_OF_STOCK", langGeleden), true);
});

test("needsInventoryAttention: recent 'genoeg' hoeft geen aandacht", () => {
  const vandaag = new Date();
  const vijfDagenGeleden = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  assert.equal(needsInventoryAttention("SUFFICIENT", vandaag), false);
  assert.equal(needsInventoryAttention("SUFFICIENT", vijfDagenGeleden), false);
});

test("needsInventoryAttention: verlopen 'genoeg' vraagt weer om een korte herbevestiging", () => {
  const nu = new Date("2026-08-01T00:00:00Z");
  const nogNet = new Date("2026-07-11T00:00:01Z"); // net binnen 21 dagen
  const teLangGeleden = new Date("2026-07-10T00:00:00Z"); // 22 dagen geleden
  assert.equal(needsInventoryAttention("SUFFICIENT", nogNet, nu), false);
  assert.equal(needsInventoryAttention("SUFFICIENT", teLangGeleden, nu), true);
});

async function makeHouseholdWithMealPlan(name: string, recipeTitle: string) {
  const household = await prisma.household.create({
    data: { name, persons: { create: [{ name: "Test", role: "PARENT" }] } },
  });
  const variant = await prisma.recipeVariant.findFirstOrThrow({
    where: { recipe: { title: recipeTitle } },
    include: { recipe: { include: { ingredients: true } } },
  });
  // De echte huidige week: syncShoppingListForInventoryChange leidt "deze
  // week" zelf af via getCurrentWeekStart(), dus de testfixture moet
  // daarmee overeenkomen, anders vindt sync domweg geen mealPlan.
  const weekStart = getCurrentWeekStart();
  const mealPlan = await prisma.mealPlan.create({
    data: {
      householdId: household.id,
      weekStart,
      status: "CONFIRMED",
      entries: { create: [{ dayOfWeek: "MONDAY", recipeVariantId: variant.id }] },
    },
  });
  return { household, mealPlan, variant };
}

async function cleanup(householdId: string) {
  await prisma.shoppingList.deleteMany({ where: { mealPlan: { householdId } } });
  await prisma.mealPlan.deleteMany({ where: { householdId } });
  await prisma.inventoryItem.deleteMany({ where: { householdId } });
  await prisma.person.deleteMany({ where: { householdId } });
  await prisma.household.delete({ where: { id: householdId } });
}

test("status SUFFICIENT verlaagt de netto-behoefte tot 0 en schrapt de MEAL-regel", async () => {
  const { household, mealPlan } = await makeHouseholdWithMealPlan(
    "WP4 integratietest — genoeg",
    "Pasta bolognese"
  );
  const pastaIngredient = await prisma.ingredient.findUniqueOrThrow({ where: { name: "Pasta" } });

  try {
    await setInventoryStatus(household.id, pastaIngredient.id, "SUFFICIENT");
    const shoppingList = await ensureShoppingList(mealPlan.id, household.id);
    const pastaLine = shoppingList.lines.find(
      (l) => l.ingredientId === pastaIngredient.id && l.source === "MEAL"
    );
    assert.equal(pastaLine, undefined, "geen MEAL-regel meer voor Pasta na 'genoeg'");
  } finally {
    await cleanup(household.id);
  }
});

test("status LOW laat de volledige receptbehoefte staan", async () => {
  const { household, mealPlan } = await makeHouseholdWithMealPlan(
    "WP4 integratietest — bijna op",
    "Pasta bolognese"
  );
  const pastaIngredient = await prisma.ingredient.findUniqueOrThrow({ where: { name: "Pasta" } });
  const recipeIngredient = await prisma.recipeIngredient.findFirstOrThrow({
    where: { ingredientId: pastaIngredient.id, recipe: { title: "Pasta bolognese" } },
  });

  try {
    await setInventoryStatus(household.id, pastaIngredient.id, "LOW");
    const shoppingList = await ensureShoppingList(mealPlan.id, household.id);
    const pastaLine = shoppingList.lines.find(
      (l) => l.ingredientId === pastaIngredient.id && l.source === "MEAL"
    );
    assert.ok(pastaLine, "MEAL-regel voor Pasta moet blijven bestaan bij 'bijna op'");
    assert.equal(pastaLine!.quantity, recipeIngredient.quantity);
  } finally {
    await cleanup(household.id);
  }
});

test("een waarschijnlijk-in-huis-ingrediënt dat niet in het weekmenu zit, wordt toegevoegd bij 'bijna op'", async () => {
  const { household, mealPlan, variant } = await makeHouseholdWithMealPlan(
    "WP4 integratietest — aanvullen",
    "Pasta bolognese"
  );
  const usedIngredientIds = new Set(variant.recipe.ingredients.map((ri) => ri.ingredientId));
  const uncoveredLikelyInStock = await prisma.ingredient.findFirstOrThrow({
    where: { likelyInStock: true, id: { notIn: Array.from(usedIngredientIds) } },
  });

  try {
    await setInventoryStatus(household.id, uncoveredLikelyInStock.id, "LOW");
    const shoppingList = await ensureShoppingList(mealPlan.id, household.id);
    const line = shoppingList.lines.find(
      (l) => l.ingredientId === uncoveredLikelyInStock.id && l.source === "INVENTORY"
    );
    assert.ok(line, `verwacht een INVENTORY-regel voor ${uncoveredLikelyInStock.name}`);
    assert.equal(line!.needsReview, true);
  } finally {
    await cleanup(household.id);
  }
});

test("status UNKNOWN (nog niet ingevuld) voegt niets proactief toe", async () => {
  const { household, mealPlan, variant } = await makeHouseholdWithMealPlan(
    "WP4 integratietest — onbekend",
    "Pasta bolognese"
  );
  const usedIngredientIds = new Set(variant.recipe.ingredients.map((ri) => ri.ingredientId));
  const uncoveredLikelyInStock = await prisma.ingredient.findFirstOrThrow({
    where: { likelyInStock: true, id: { notIn: Array.from(usedIngredientIds) } },
  });

  try {
    // Bewust geen setInventoryStatus aangeroepen — status blijft UNKNOWN.
    const shoppingList = await ensureShoppingList(mealPlan.id, household.id);
    const line = shoppingList.lines.find((l) => l.ingredientId === uncoveredLikelyInStock.id);
    assert.equal(line, undefined);
  } finally {
    await cleanup(household.id);
  }
});

test("een statuswijziging ná het genereren van de lijst werkt de bestaande MEAL-regel bij, niet pas volgende week", async () => {
  const { household, mealPlan } = await makeHouseholdWithMealPlan(
    "WP4 integratietest — sync bestaande lijst",
    "Pasta bolognese"
  );
  const pastaIngredient = await prisma.ingredient.findUniqueOrThrow({ where: { name: "Pasta" } });
  const recipeIngredient = await prisma.recipeIngredient.findFirstOrThrow({
    where: { ingredientId: pastaIngredient.id, recipe: { title: "Pasta bolognese" } },
  });

  try {
    // Lijst genereren terwijl de status nog UNKNOWN is: volledige behoefte.
    const firstList = await ensureShoppingList(mealPlan.id, household.id);
    const before = firstList.lines.find((l) => l.ingredientId === pastaIngredient.id && l.source === "MEAL");
    assert.equal(before?.quantity, recipeIngredient.quantity);

    // Nu pas de status wijzigen — de lijst bestaat al.
    await setInventoryStatus(household.id, pastaIngredient.id, "SUFFICIENT");
    await syncShoppingListForInventoryChange(household.id, pastaIngredient.id);

    const afterSufficient = await prisma.shoppingList.findUniqueOrThrow({
      where: { mealPlanId: mealPlan.id },
      include: { lines: true },
    });
    assert.equal(
      afterSufficient.lines.find((l) => l.ingredientId === pastaIngredient.id && l.source === "MEAL"),
      undefined,
      "MEAL-regel moet verdwijnen zodra de bestaande lijst gesynchroniseerd wordt"
    );

    // En weer terug: bijna op moet de regel laten terugkeren, zelfde lijst.
    await setInventoryStatus(household.id, pastaIngredient.id, "LOW");
    await syncShoppingListForInventoryChange(household.id, pastaIngredient.id);

    const afterLow = await prisma.shoppingList.findUniqueOrThrow({
      where: { mealPlanId: mealPlan.id },
      include: { lines: true },
    });
    const restored = afterLow.lines.find((l) => l.ingredientId === pastaIngredient.id && l.source === "MEAL");
    assert.ok(restored, "MEAL-regel moet terugkeren zodra de status weer 'bijna op' wordt");
    assert.equal(restored!.quantity, recipeIngredient.quantity);
  } finally {
    await cleanup(household.id);
  }
});

test("een INVENTORY-regel verschijnt en verdwijnt live in een al-bestaande lijst", async () => {
  const { household, mealPlan, variant } = await makeHouseholdWithMealPlan(
    "WP4 integratietest — sync inventory-regel",
    "Pasta bolognese"
  );
  const usedIngredientIds = new Set(variant.recipe.ingredients.map((ri) => ri.ingredientId));
  const uncovered = await prisma.ingredient.findFirstOrThrow({
    where: { likelyInStock: true, id: { notIn: Array.from(usedIngredientIds) } },
  });

  try {
    const firstList = await ensureShoppingList(mealPlan.id, household.id);
    assert.equal(
      firstList.lines.find((l) => l.ingredientId === uncovered.id),
      undefined,
      "nog geen regel zolang de status onbekend is"
    );

    await setInventoryStatus(household.id, uncovered.id, "OUT_OF_STOCK");
    await syncShoppingListForInventoryChange(household.id, uncovered.id);
    const afterOutOfStock = await prisma.shoppingList.findUniqueOrThrow({
      where: { mealPlanId: mealPlan.id },
      include: { lines: true },
    });
    assert.ok(
      afterOutOfStock.lines.find((l) => l.ingredientId === uncovered.id && l.source === "INVENTORY"),
      "INVENTORY-regel moet meteen verschijnen"
    );

    await setInventoryStatus(household.id, uncovered.id, "SUFFICIENT");
    await syncShoppingListForInventoryChange(household.id, uncovered.id);
    const afterSufficient = await prisma.shoppingList.findUniqueOrThrow({
      where: { mealPlanId: mealPlan.id },
      include: { lines: true },
    });
    assert.equal(
      afterSufficient.lines.find((l) => l.ingredientId === uncovered.id),
      undefined,
      "INVENTORY-regel moet weer verdwijnen zodra alsnog 'genoeg' wordt aangegeven"
    );
  } finally {
    await cleanup(household.id);
  }
});

test("voorraadstatus blijft bewaard tussen weken (geen reset)", async () => {
  const household = await prisma.household.create({
    data: { name: "WP4 integratietest — onthouden", persons: { create: [{ name: "Test", role: "PARENT" }] } },
  });
  const ingredient = await prisma.ingredient.findFirstOrThrow({ where: { likelyInStock: true } });

  try {
    await setInventoryStatus(household.id, ingredient.id, "OUT_OF_STOCK");
    const firstRead = await getInventoryChecklist(household.id);
    assert.equal(firstRead.find((i) => i.ingredientId === ingredient.id)?.status, "OUT_OF_STOCK");

    // Simuleer "een week later": gewoon opnieuw opvragen zonder iets te wijzigen.
    const secondRead = await getInventoryChecklist(household.id);
    assert.equal(secondRead.find((i) => i.ingredientId === ingredient.id)?.status, "OUT_OF_STOCK");
  } finally {
    await cleanup(household.id);
  }
});

test("getInventoryChecklist: 'genoeg' geeft needsAttention=false, andere statussen true", async () => {
  const household = await prisma.household.create({
    data: { name: "WP60 integratietest — needsAttention", persons: { create: [{ name: "Test", role: "PARENT" }] } },
  });
  const [sufficientIngredient, unknownIngredient] = await prisma.ingredient.findMany({
    where: { likelyInStock: true },
    take: 2,
  });

  try {
    await setInventoryStatus(household.id, sufficientIngredient.id, "SUFFICIENT");
    const checklist = await getInventoryChecklist(household.id);

    assert.equal(
      checklist.find((i) => i.ingredientId === sufficientIngredient.id)?.needsAttention,
      false,
      "een net bevestigd 'genoeg' hoeft deze week geen aandacht"
    );
    assert.equal(
      checklist.find((i) => i.ingredientId === unknownIngredient.id)?.needsAttention,
      true,
      "een nog nooit ingevuld basisproduct blijft om aandacht vragen"
    );
  } finally {
    await cleanup(household.id);
  }
});

test("een overgeslagen dag (uit eten) levert geen boodschappenregels op voor die maaltijd, tegen een echte, opgebouwde lijst", async () => {
  const { household, mealPlan, variant: mondayVariant } = await makeHouseholdWithMealPlan(
    "WP-uit-eten integratietest",
    "Pasta bolognese"
  );
  const wrapsVariant = await prisma.recipeVariant.findFirstOrThrow({
    where: { recipe: { title: "Kipwraps" } },
    include: { recipe: { include: { ingredients: true } } },
  });

  try {
    await prisma.mealPlanEntry.create({
      data: { mealPlanId: mealPlan.id, dayOfWeek: "TUESDAY", recipeVariantId: wrapsVariant.id, skipped: true },
    });

    const shoppingList = await ensureShoppingList(mealPlan.id, household.id);
    const lineIngredientIds = new Set(shoppingList.lines.map((line) => line.ingredientId));

    const mondayIngredientIds = mondayVariant.recipe.ingredients.map((ri) => ri.ingredientId);
    const wrapsOnlyIngredientIds = wrapsVariant.recipe.ingredients
      .map((ri) => ri.ingredientId)
      .filter((id) => !mondayIngredientIds.includes(id));

    assert.ok(
      mondayIngredientIds.some((id) => lineIngredientIds.has(id)),
      "de niet-overgeslagen maandagmaaltijd moet gewoon op de boodschappenlijst staan"
    );
    for (const id of wrapsOnlyIngredientIds) {
      assert.equal(
        lineIngredientIds.has(id),
        false,
        "een ingrediënt dat alleen bij de overgeslagen (uit eten) dinsdag hoort, mag niet op de boodschappenlijst staan"
      );
    }
  } finally {
    await cleanup(household.id);
  }
});
