/**
 * Integratietest tegen een echte (lokale) Postgres — de wisselwerking
 * tussen een vaste daggewoonte (WP51) en de harde-beperkingenfilter is
 * precies het gedrag dat een gemockte Prisma-laag zou wegpoetsen.
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { ensureMealPlan } from "./mealPlan";
import { getCurrentWeekStart } from "./week";
import { weekParityForDate } from "@/domain/week/isoWeek";
import { getIngredientsOnOffer } from "./pricing/offers";

async function makeHousehold(name: string, hardRestrictions: string[] = []) {
  return prisma.household.create({
    data: {
      name,
      persons: { create: [{ name: "Test", role: "PARENT", hardRestrictions, defaultPresent: true }] },
    },
  });
}

async function cleanup(householdId: string) {
  await prisma.mealSuggestion.deleteMany({ where: { householdId } });
  await prisma.mealPlan.deleteMany({ where: { householdId } });
  await prisma.dayRoutine.deleteMany({ where: { householdId } });
  await prisma.mealDayRule.deleteMany({ where: { householdId } });
  await prisma.person.deleteMany({ where: { householdId } });
  await prisma.household.delete({ where: { id: householdId } });
}

test("een vaste daggewoonte wordt gebruikt in plaats van de gewone scoring", async () => {
  const household = await makeHousehold("WP51 integratietest — gewoonte gebruikt");
  const variant = await prisma.recipeVariant.findFirstOrThrow({
    where: { recipe: { ingredients: { some: { ingredient: { restrictionTags: { has: "lactose" } } } } } },
  });

  try {
    await prisma.dayRoutine.create({
      data: { householdId: household.id, dayOfWeek: "MONDAY", recipeVariantId: variant.id },
    });

    const weekStart = getCurrentWeekStart();
    const mealPlan = await ensureMealPlan(household.id, weekStart);
    const mondayEntry = mealPlan!.entries.find((e) => e.dayOfWeek === "MONDAY");
    assert.equal(mondayEntry?.recipeVariantId, variant.id);
    assert.match(mondayEntry?.reason ?? "", /vaste gewoonte/);
    assert.equal(mondayEntry?.source, "AUTO");
    assert.equal(mondayEntry?.status, "PROPOSED");
    assert.equal(mondayEntry?.confidenceLevel, "CERTAIN");
    assert.equal(mondayEntry?.score, null, "een daggewoonte doorloopt de scoring niet, dus geen score");
  } finally {
    await cleanup(household.id);
  }
});

test("een vaste daggewoonte die een harde beperking schendt wordt genegeerd, geen stille aanname", async () => {
  const household = await makeHousehold("WP51 integratietest — gewoonte botst met allergie", ["lactose"]);
  const variant = await prisma.recipeVariant.findFirstOrThrow({
    where: { recipe: { ingredients: { some: { ingredient: { restrictionTags: { has: "lactose" } } } } } },
  });

  try {
    await prisma.dayRoutine.create({
      data: { householdId: household.id, dayOfWeek: "MONDAY", recipeVariantId: variant.id },
    });

    const weekStart = getCurrentWeekStart();
    const mealPlan = await ensureMealPlan(household.id, weekStart);
    const mondayEntry = mealPlan!.entries.find((e) => e.dayOfWeek === "MONDAY");
    assert.ok(mondayEntry, "maandag moet nog steeds een keuze krijgen");
    assert.notEqual(
      mondayEntry!.recipeVariantId,
      variant.id,
      "de lactose-gewoonte mag niet gekozen worden voor een huishouden met een lactose-beperking"
    );
  } finally {
    await cleanup(household.id);
  }
});

test("geen vaste daggewoonte laat de gewone scoring gewoon werken", async () => {
  const household = await makeHousehold("WP51 integratietest — geen gewoonte ingesteld");

  try {
    const weekStart = getCurrentWeekStart();
    const mealPlan = await ensureMealPlan(household.id, weekStart);
    assert.equal(mealPlan!.entries.length, 7);
  } finally {
    await cleanup(household.id);
  }
});

test("WP52: automatisch voorgestelde regels krijgen bron/status/score voor later leren uit stil accepteren", async () => {
  const household = await makeHousehold("WP52 integratietest — auto-context");

  try {
    const weekStart = getCurrentWeekStart();
    const mealPlan = await ensureMealPlan(household.id, weekStart);
    for (const entry of mealPlan!.entries) {
      assert.equal(entry.source, "AUTO");
      assert.equal(entry.status, "PROPOSED");
      assert.ok(entry.reason && entry.reason.length > 0, "elke regel moet een reden hebben");
      assert.ok(typeof entry.score === "number", "een normaal gescoorde regel heeft een numerieke score");
      assert.equal(entry.replacedFromRecipeVariantId, null, "een verse weekplanning heeft nog niets vervangen");
    }
  } finally {
    await cleanup(household.id);
  }
});

test("WP52: 'Week opnieuw plannen' markeert nieuwe regels als REGENERATED, niet als AUTO", async () => {
  const household = await makeHousehold("WP52 integratietest — regenerated");

  try {
    const weekStart = getCurrentWeekStart();
    await ensureMealPlan(household.id, weekStart);
    await prisma.mealPlan.deleteMany({ where: { householdId: household.id } });

    const regenerated = await ensureMealPlan(household.id, weekStart, "REGENERATED");
    for (const entry of regenerated!.entries) {
      assert.equal(entry.source, "REGENERATED");
    }
  } finally {
    await cleanup(household.id);
  }
});

test("WP68: een verborgen gerecht (Fase 11) wordt niet meer voorgesteld, ook niet als vaste daggewoonte", async () => {
  const household = await makeHousehold("WP68 integratietest — verborgen gerecht");
  const variant = await prisma.recipeVariant.findFirstOrThrow({ where: { recipe: { scope: "GLOBAL" } } });

  try {
    await prisma.dayRoutine.create({
      data: { householdId: household.id, dayOfWeek: "MONDAY", recipeVariantId: variant.id },
    });
    await prisma.preference.create({
      data: {
        ownerType: "HOUSEHOLD",
        ownerId: household.id,
        subjectType: "RECIPE_VARIANT",
        subjectId: variant.id,
        stance: "RATHER_NOT",
        source: "INFERRED",
        confidence: 0.1,
        hiddenAt: new Date(),
      },
    });

    const weekStart = getCurrentWeekStart();
    const mealPlan = await ensureMealPlan(household.id, weekStart);
    for (const entry of mealPlan!.entries) {
      assert.notEqual(
        entry.recipeVariantId,
        variant.id,
        "een verborgen gerecht mag geen enkele dag voorgesteld worden, zelfs niet als vaste daggewoonte"
      );
    }
  } finally {
    await prisma.preference.deleteMany({ where: { ownerId: household.id, subjectId: variant.id } });
    await cleanup(household.id);
  }
});


// ── Weekritme: dagregels en dagprofielen ────────────────────────────────────

function nextWeekStart(from: Date = getCurrentWeekStart()): Date {
  const start = new Date(from);
  start.setDate(start.getDate() + 7);
  return start;
}

test("weekritme: een vast gerecht in de dagregel wint van de gewone scoring", async () => {
  const household = await makeHousehold("Weekritme — vast gerecht in de dagregel");
  const variant = await prisma.recipeVariant.findFirstOrThrow({
    where: { recipe: { category: "AIRFRYER" } },
  });

  try {
    await prisma.mealDayRule.create({
      data: {
        householdId: household.id,
        dayOfWeek: "SUNDAY",
        weekParity: "EVERY",
        profileKey: "FIXED",
        fixedRecipeVariantId: variant.id,
      },
    });

    const mealPlan = await ensureMealPlan(household.id, getCurrentWeekStart());
    const sunday = mealPlan!.entries.find((entry) => entry.dayOfWeek === "SUNDAY");
    assert.equal(sunday?.recipeVariantId, variant.id, "de patatdag hoort exact te blijven staan");
    assert.match(sunday?.reason ?? "", /staat vast/);
  } finally {
    await cleanup(household.id);
  }
});

test("weekritme: een vast gerecht dat een harde beperking schendt wordt genegeerd", async () => {
  // Zelfde regel als bij een daggewoonte: hard is hard, ook voor iets dat de
  // gebruiker als "dit ligt vast" heeft ingesteld.
  const household = await makeHousehold("Weekritme — vast gerecht versus allergie", ["lactose"]);
  const unsafeVariant = await prisma.recipeVariant.findFirstOrThrow({
    where: { recipe: { ingredients: { some: { ingredient: { restrictionTags: { has: "lactose" } } } } } },
  });

  try {
    await prisma.mealDayRule.create({
      data: {
        householdId: household.id,
        dayOfWeek: "SUNDAY",
        weekParity: "EVERY",
        profileKey: "FIXED",
        fixedRecipeVariantId: unsafeVariant.id,
      },
    });

    const mealPlan = await ensureMealPlan(household.id, getCurrentWeekStart());
    const sunday = mealPlan!.entries.find((entry) => entry.dayOfWeek === "SUNDAY");
    assert.notEqual(sunday?.recipeVariantId, unsafeVariant.id);
    assert.ok(sunday?.recipeVariantId, "er moet wel gewoon een maaltijd gepland zijn");
  } finally {
    await cleanup(household.id);
  }
});

test("weekritme: een dagprofiel stuurt de keuze en komt terug in de uitleg", async () => {
  const household = await makeHousehold("Weekritme — dagprofiel stuurt de keuze");
  try {
    await prisma.mealDayRule.create({
      data: {
        householdId: household.id,
        dayOfWeek: "MONDAY",
        weekParity: "EVERY",
        profileKey: "BUSY_EARLY_REHEATABLE",
      },
    });

    const mealPlan = await ensureMealPlan(household.id, getCurrentWeekStart());
    const monday = mealPlan!.entries.find((entry) => entry.dayOfWeek === "MONDAY")!;
    const chosen = await prisma.recipeVariant.findUniqueOrThrow({
      where: { id: monday.recipeVariantId! },
      include: { recipe: true },
    });

    const isEasyOrReheatable =
      chosen.variantType === "FAST" ||
      chosen.variantType === "REHEATABLE" ||
      chosen.recipe.properties.includes("snel") ||
      chosen.recipe.properties.includes("opwarmbaar");
    assert.ok(
      isEasyOrReheatable,
      `op een drukke maandag hoort een snelle of opwarmbare maaltijd te komen, kreeg "${chosen.recipe.title}" (${chosen.variantType}, ${chosen.recipe.properties.join(", ")})`
    );
    assert.match(monday.reason ?? "", /maandag/);
  } finally {
    await cleanup(household.id);
  }
});

test("weekritme: een regel voor even weken raakt alleen die weken", async () => {
  const household = await makeHousehold("Weekritme — pariteit per week");
  const fixedVariant = await prisma.recipeVariant.findFirstOrThrow({
    where: { recipe: { category: "AIRFRYER" } },
  });

  try {
    const thisWeek = getCurrentWeekStart();
    const next = nextWeekStart(thisWeek);
    // Opeenvolgende weken hebben altijd een verschillende pariteit; de regel
    // hangt aan die van de vólgende week.
    await prisma.mealDayRule.create({
      data: {
        householdId: household.id,
        dayOfWeek: "SATURDAY",
        weekParity: weekParityForDate(next),
        profileKey: "FIXED",
        fixedRecipeVariantId: fixedVariant.id,
      },
    });

    const planThisWeek = await ensureMealPlan(household.id, thisWeek);
    const planNextWeek = await ensureMealPlan(household.id, next);

    assert.equal(
      planNextWeek!.entries.find((entry) => entry.dayOfWeek === "SATURDAY")?.recipeVariantId,
      fixedVariant.id,
      "in de weeksoort van de regel hoort het vaste gerecht te staan"
    );
    assert.notEqual(
      planThisWeek!.entries.find((entry) => entry.dayOfWeek === "SATURDAY")?.recipeVariantId,
      fixedVariant.id,
      "in de andere weeksoort mag die regel niets doen"
    );
  } finally {
    await cleanup(household.id);
  }
});

test("weekritme: een huishouden zonder dagregels krijgt exact het oude gedrag", async () => {
  // De backwards-compatibiliteitstest op databaseniveau: twee identieke
  // huishoudens, één met en één zonder dagregels, moeten zonder regels tot
  // dezelfde week komen.
  const withoutRules = await makeHousehold("Weekritme — zonder regels A");
  const alsoWithoutRules = await makeHousehold("Weekritme — zonder regels B");
  try {
    const weekStart = getCurrentWeekStart();
    const planA = await ensureMealPlan(withoutRules.id, weekStart);
    const planB = await ensureMealPlan(alsoWithoutRules.id, weekStart);

    const dishesA = planA!.entries
      .sort((a, b) => a.dayOfWeek.localeCompare(b.dayOfWeek))
      .map((entry) => entry.recipeVariantId);
    const dishesB = planB!.entries
      .sort((a, b) => a.dayOfWeek.localeCompare(b.dayOfWeek))
      .map((entry) => entry.recipeVariantId);

    assert.deepEqual(dishesA, dishesB, "de planning is deterministisch en verandert niet door het weekritme");
    assert.equal(dishesA.filter(Boolean).length, 7, "alle zeven avonden horen een maaltijd te hebben");
  } finally {
    await cleanup(withoutRules.id);
    await cleanup(alsoWithoutRules.id);
  }
});


test("aanbieding: alleen een échte actie telt als aanbieding voor de weekplanning", async () => {
  // Bewijst het gedrag dat de weekplanning gebruikt, tegen de echte database:
  // een van-prijs die eerder ook werkelijk gerekend is levert een aanbieding
  // op, dezelfde actie met een verzonnen van-prijs niet.
  const recipeIngredient = await prisma.recipeIngredient.findFirstOrThrow({ include: { ingredient: true } });
  const namen = new Map([[recipeIngredient.ingredientId, recipeIngredient.ingredient.name]]);

  async function meetPrijsverloop(eerderePrijs: number) {
    const product = await prisma.product.create({
      data: {
        ingredientId: recipeIngredient.ingredientId,
        provider: "AH",
        externalRef: `ah-actie-${Math.random().toString(36).slice(2)}`,
        name: `AH ${recipeIngredient.ingredient.name}`,
        brand: "AH",
        packageSize: "500 gram",
        packageQuantity: 500,
        price: 1.99,
        qualityTier: "STANDAARD",
      },
    });
    const dagen = (aantal: number) => new Date(Date.now() - aantal * 24 * 60 * 60 * 1000);
    await prisma.priceObservation.createMany({
      data: [
        { productId: product.id, price: eerderePrijs, observedAt: dagen(28), source: "API" },
        { productId: product.id, price: eerderePrijs, observedAt: dagen(21), source: "API" },
        { productId: product.id, price: eerderePrijs, observedAt: dagen(14), source: "API" },
        { productId: product.id, price: eerderePrijs, observedAt: dagen(7), source: "API" },
        {
          productId: product.id,
          price: 1.99,
          wasPrice: 2.99,
          promoLabel: "1+1 gratis",
          promoType: "X_VOOR_Y",
          observedAt: new Date(),
          source: "API",
        },
      ],
    });
    return product;
  }

  // Geval 1: de van-prijs van € 2,99 was hier eerder ook echt de prijs.
  const echt = await meetPrijsverloop(2.99);
  try {
    const offers = await getIngredientsOnOffer([recipeIngredient.ingredientId], namen, ["AH"]);
    const offer = offers.get(recipeIngredient.ingredientId);
    assert.ok(offer, "een echte korting hoort als aanbieding te tellen");
    assert.equal(offer!.storeLabel, "Albert Heijn");
    assert.equal(offer!.promoLabel, "1+1 gratis");
  } finally {
    await prisma.priceObservation.deleteMany({ where: { productId: echt.id } });
    await prisma.product.delete({ where: { id: echt.id } });
  }

  // Geval 2: exact dezelfde actie, maar de van-prijs is hier nooit gerekend.
  const nep = await meetPrijsverloop(1.99);
  try {
    const offers = await getIngredientsOnOffer([recipeIngredient.ingredientId], namen, ["AH"]);
    assert.equal(
      offers.get(recipeIngredient.ingredientId),
      undefined,
      "een nepkorting mag het weekmenu niet sturen"
    );
  } finally {
    await prisma.priceObservation.deleteMany({ where: { productId: nep.id } });
    await prisma.product.delete({ where: { id: nep.id } });
  }
});
