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
import { ensureShoppingList, getGroceryMealEntries, invalidateShoppingList } from "./shoppingList";
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
