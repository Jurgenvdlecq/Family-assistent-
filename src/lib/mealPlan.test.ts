/**
 * Integratietest tegen een echte (lokale) Postgres — de wisselwerking
 * tussen een vaste daggewoonte (WP51) en de harde-beperkingenfilter is
 * precies het gedrag dat een gemockte Prisma-laag zou wegpoetsen.
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { ensureMealPlan, getReasonsForPlan } from "./mealPlan";
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

    const reasons = await getReasonsForPlan(household.id, weekStart);
    assert.match(reasons.get(variant.id) ?? "", /vaste gewoonte/);
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
