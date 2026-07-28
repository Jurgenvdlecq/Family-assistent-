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
