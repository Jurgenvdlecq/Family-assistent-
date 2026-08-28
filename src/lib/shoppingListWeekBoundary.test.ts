/**
 * Integratietest tegen een echte (lokale) Postgres via DATABASE_URL.
 *
 * Kern van deze test: de dagkeuze mag over de weekgrens heen. Bestel je op
 * zaterdag en wil je dinsdag koken, dan valt die dinsdag in het weekplan van
 * de vólgende week — terwijl de boodschappenlijst aan het weekplan van déze
 * week hangt. De behoefte moet dus uit twee plannen kunnen komen, anders is
 * "koken op dinsdag" een keuze die stilzwijgend niets oplevert.
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { ensureMealPlan } from "./mealPlan";
import {
  ensureShoppingList,
  getGroceryMealEntries,
  invalidateShoppingList,
  invalidateShoppingListForPlanChange,
  releaseNextWeekMealDays,
} from "./shoppingList";
import { getCurrentWeekStart } from "./week";

async function makeHousehold(name: string) {
  return prisma.household.create({ data: { name, persons: { create: [{ name: "Test", role: "PARENT" }] } } });
}

async function cleanup(householdId: string) {
  await prisma.shoppingList.deleteMany({ where: { mealPlan: { householdId } } });
  await prisma.mealPlan.deleteMany({ where: { householdId } });
  await prisma.fixedGrocery.deleteMany({ where: { householdId } });
  await prisma.feedbackEvent.deleteMany({ where: { householdId } });
  await prisma.mealSuggestion.deleteMany({ where: { householdId } });
  await prisma.preference.deleteMany({ where: { ownerId: householdId } });
  await prisma.person.deleteMany({ where: { householdId } });
  await prisma.household.delete({ where: { id: householdId } });
}

function nextWeekStart(): Date {
  const start = getCurrentWeekStart();
  start.setDate(start.getDate() + 7);
  return start;
}

test("een aangevinkte avond in de volgende week levert boodschappen op de lijst van deze week", async () => {
  const household = await makeHousehold("Weekgrens — volgende week telt mee");
  try {
    const thisWeek = await ensureMealPlan(household.id, getCurrentWeekStart());
    const nextWeek = await ensureMealPlan(household.id, nextWeekStart());
    assert.ok(thisWeek && nextWeek, "testopzet: beide weekplannen moeten bestaan");

    // Niets aangevinkt: alleen vaste boodschappen/voorraad, geen receptregels.
    const withoutMeals = await ensureShoppingList(thisWeek!.id, household.id);
    assert.equal(
      withoutMeals.lines.filter((line) => line.source === "MEAL").length,
      0,
      "testopzet: opt-in per avond betekent dat een verse week geen receptregels heeft"
    );

    // Eén avond in de vólgende week aanvinken — precies het scenario
    // "bezorging zaterdag, koken dinsdag".
    const nextWeekEntry = await prisma.mealPlanEntry.findFirstOrThrow({
      where: { mealPlanId: nextWeek!.id },
      orderBy: { dayOfWeek: "asc" },
    });
    await prisma.mealPlanEntry.update({
      where: { id: nextWeekEntry.id },
      data: { includedInGroceries: true },
    });
    await invalidateShoppingList(thisWeek!.id);

    const rebuilt = await ensureShoppingList(thisWeek!.id, household.id);
    const mealLines = rebuilt.lines.filter((line) => line.source === "MEAL");
    assert.ok(
      mealLines.length > 0,
      "de boodschappen voor een avond in de volgende week horen op de lijst van deze bestelling te staan"
    );
  } finally {
    await cleanup(household.id);
  }
});

test("getGroceryMealEntries bundelt deze en de volgende week, en niets daarbuiten", async () => {
  const household = await makeHousehold("Weekgrens — bereik van de bundeling");
  try {
    const thisWeek = await ensureMealPlan(household.id, getCurrentWeekStart());
    const nextWeek = await ensureMealPlan(household.id, nextWeekStart());

    // Een week verder vooruit mag niet meetellen: de dagkeuze biedt die dagen
    // ook niet aan, en de lijst zou ze stilzwijgend meenemen.
    const weekAfterNext = getCurrentWeekStart();
    weekAfterNext.setDate(weekAfterNext.getDate() + 14);
    const laterWeek = await ensureMealPlan(household.id, weekAfterNext);
    assert.ok(thisWeek && nextWeek && laterWeek, "testopzet: drie weekplannen");

    const { entries, nextWeekPlan } = await getGroceryMealEntries(thisWeek!.id);

    assert.equal(nextWeekPlan?.id, nextWeek!.id);
    const planIds = new Set(entries.map((entry) => entry.mealPlanId));
    assert.deepEqual(
      [...planIds].sort(),
      [thisWeek!.id, nextWeek!.id].sort(),
      "alleen deze en de volgende week horen in de bundeling"
    );
    assert.ok(!planIds.has(laterWeek!.id), "een week verder vooruit mag nooit stilzwijgend meetellen");
  } finally {
    await cleanup(household.id);
  }
});

test("een niet-aangevinkte avond in de volgende week levert niets op", async () => {
  const household = await makeHousehold("Weekgrens — niet aangevinkt telt niet");
  try {
    const thisWeek = await ensureMealPlan(household.id, getCurrentWeekStart());
    await ensureMealPlan(household.id, nextWeekStart());
    assert.ok(thisWeek, "testopzet: weekplan van deze week");

    const list = await ensureShoppingList(thisWeek!.id, household.id);
    assert.equal(
      list.lines.filter((line) => line.source === "MEAL").length,
      0,
      "zonder aangevinkte avonden komt er uit geen van beide weken een receptregel"
    );
  } finally {
    await cleanup(household.id);
  }
});

test("een gerecht wisselen op een avond in de volgende week werkt de lijst van deze week bij", async () => {
  // Code-reviewbevinding: `invalidateShoppingList(planVanDeVolgendeWeek)` doet
  // niets, want dát plan heeft zelf geen boodschappenlijst. De lijst van de
  // huidige week bleef daardoor stilzwijgend op het oude gerecht staan —
  // verkeerde producten besteld, en de tekortcontrole ziet het niet omdat er
  // voor het nieuwe gerecht helemaal geen regel bestaat.
  const household = await makeHousehold("Weekgrens — gerecht wisselen");
  try {
    const thisWeek = await ensureMealPlan(household.id, getCurrentWeekStart());
    const nextWeek = await ensureMealPlan(household.id, nextWeekStart());
    assert.ok(thisWeek && nextWeek, "testopzet: beide weekplannen");

    const entry = await prisma.mealPlanEntry.findFirstOrThrow({
      where: { mealPlanId: nextWeek!.id },
      orderBy: { dayOfWeek: "asc" },
    });
    await prisma.mealPlanEntry.update({ where: { id: entry.id }, data: { includedInGroceries: true } });
    await invalidateShoppingList(thisWeek!.id);

    const before = await ensureShoppingList(thisWeek!.id, household.id);
    const ingredientsBefore = new Set(
      before.lines.filter((line) => line.source === "MEAL").map((line) => line.ingredientId)
    );
    assert.ok(ingredientsBefore.size > 0, "testopzet: het oude gerecht moet regels opleveren");

    // Een ander gerecht kiezen voor diezelfde avond, met andere ingrediënten.
    const otherVariant = await prisma.recipeVariant.findFirstOrThrow({
      where: {
        id: { not: entry.recipeVariantId },
        recipe: { ingredients: { none: { ingredientId: { in: [...ingredientsBefore] } } } },
      },
      include: { recipe: { include: { ingredients: true } } },
    });
    await prisma.mealPlanEntry.update({
      where: { id: entry.id },
      data: { recipeVariantId: otherVariant.id },
    });

    // Zo deed de code het vóór de fix: het gewijzigde plan invalideren.
    await invalidateShoppingList(nextWeek!.id);
    const stale = await ensureShoppingList(thisWeek!.id, household.id);
    assert.deepEqual(
      new Set(stale.lines.filter((line) => line.source === "MEAL").map((line) => line.ingredientId)),
      ingredientsBefore,
      "bewijst de bug: alleen het gewijzigde plan invalideren laat de lijst op het oude gerecht staan"
    );

    // En zo hoort het: de lijst die de behoefte draagt wordt herbouwd.
    await invalidateShoppingListForPlanChange(household.id, nextWeek!.id);
    const rebuilt = await ensureShoppingList(thisWeek!.id, household.id);
    const ingredientsAfter = new Set(
      rebuilt.lines.filter((line) => line.source === "MEAL").map((line) => line.ingredientId)
    );
    assert.notDeepEqual(ingredientsAfter, ingredientsBefore, "de lijst moet het nieuwe gerecht weerspiegelen");
    for (const ingredient of otherVariant.recipe.ingredients) {
      assert.ok(
        ingredientsAfter.has(ingredient.ingredientId),
        `ingrediënt van het nieuwe gerecht ontbreekt: ${ingredient.ingredientId}`
      );
    }
  } finally {
    await cleanup(household.id);
  }
});

test("een besteld avondeten in de volgende week wordt niet opnieuw voorgesteld zodra die week aanbreekt", async () => {
  // Het scenario uit de code-review: je vinkt in week W een avond van W+1 aan,
  // bestelt en krijgt bezorgd. Zodra W+1 de huidige week wordt, krijgt die een
  // verse lijst — zónder de overdrachtsmarkeringen van de vorige bestelling.
  // Stond de avond dan nog op "telt mee", dan stelt de app hetzelfde gerecht
  // doodleuk opnieuw voor.
  const household = await makeHousehold("Weekgrens — niet opnieuw voorstellen");
  try {
    const thisWeek = await ensureMealPlan(household.id, getCurrentWeekStart());
    const nextWeek = await ensureMealPlan(household.id, nextWeekStart());
    assert.ok(thisWeek && nextWeek, "testopzet: beide weekplannen");

    const nextWeekEntry = await prisma.mealPlanEntry.findFirstOrThrow({
      where: { mealPlanId: nextWeek!.id },
      orderBy: { dayOfWeek: "asc" },
    });
    const thisWeekEntry = await prisma.mealPlanEntry.findFirstOrThrow({
      where: { mealPlanId: thisWeek!.id },
      orderBy: { dayOfWeek: "asc" },
    });
    await prisma.mealPlanEntry.updateMany({
      where: { id: { in: [nextWeekEntry.id, thisWeekEntry.id] } },
      data: { includedInGroceries: true },
    });
    await invalidateShoppingList(thisWeek!.id);
    const ordered = await ensureShoppingList(thisWeek!.id, household.id);
    assert.ok(
      ordered.lines.some((line) => line.source === "MEAL"),
      "testopzet: er moeten maaltijdregels te bestellen zijn"
    );

    // Wat er gebeurt zodra de maaltijdregels naar het Picnic-mandje gaan.
    await releaseNextWeekMealDays(household.id, thisWeek!.weekStart);

    const afterNext = await prisma.mealPlanEntry.findUniqueOrThrow({ where: { id: nextWeekEntry.id } });
    assert.equal(afterNext.includedInGroceries, false, "de bestelde avond van volgende week mag niet blijven staan");

    const afterThis = await prisma.mealPlanEntry.findUniqueOrThrow({ where: { id: thisWeekEntry.id } });
    assert.equal(
      afterThis.includedInGroceries,
      true,
      "deze week blijft staan zoals de gebruiker 'm koos — daar kan niets dubbel besteld worden"
    );

    // De weekwissel simuleren: de lijst van W+1 wordt vanaf nul opgebouwd.
    const nextWeekList = await ensureShoppingList(nextWeek!.id, household.id);
    assert.equal(
      nextWeekList.lines.filter((line) => line.source === "MEAL").length,
      0,
      "het al bestelde gerecht mag in de nieuwe week niet opnieuw op de lijst komen"
    );
  } finally {
    await cleanup(household.id);
  }
});
