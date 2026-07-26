/**
 * Integratietest tegen een echte (lokale) Postgres via DATABASE_URL —
 * bewust geen mock, want juist de samenwerking tussen ensureShoppingList,
 * FixedGrocery en Product-matching is het risico (Fase 15: "Voeg
 * integratietests toe voor... boodschappenlijst genereren").
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { ensureMealPlan } from "./mealPlan";
import { ensureShoppingList } from "./shoppingList";
import {
  getFixedGroceries,
  upsertFixedGrocery,
  removeFixedGrocery,
  getIngredientsWithoutFixedGrocery,
} from "./fixedGroceries";
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

test("vaste boodschappen verschijnen als FIXED-regels in de boodschappenlijst", async () => {
  const melk = await prisma.ingredient.findUniqueOrThrow({ where: { name: "Melk" } });
  const ei = await prisma.ingredient.findUniqueOrThrow({ where: { name: "Ei" } });
  const household = await makeHousehold("WP2 integratietest — basis");

  try {
    await upsertFixedGrocery(household.id, melk.id, 1000, "ML");
    await upsertFixedGrocery(household.id, ei.id, 6, "PIECE");

    const mealPlan = await ensureMealPlan(household.id, getCurrentWeekStart());
    const shoppingList = await ensureShoppingList(mealPlan!.id, household.id);

    const fixedLines = shoppingList.lines.filter((l) => l.source === "FIXED");
    assert.equal(fixedLines.length, 2);

    const melkLine = fixedLines.find((l) => l.ingredientId === melk.id);
    assert.ok(melkLine, "melk-regel moet bestaan");
    assert.equal(melkLine!.quantity, 1000);
    assert.equal(melkLine!.unit, "ML");

    const eiLine = fixedLines.find((l) => l.ingredientId === ei.id);
    assert.ok(eiLine, "ei-regel moet bestaan");
    assert.equal(eiLine!.quantity, 6);

    // Idempotent: nogmaals aanroepen mag niets dupliceren.
    const again = await ensureShoppingList(mealPlan!.id, household.id);
    assert.equal(again.lines.filter((l) => l.source === "FIXED").length, 2);
  } finally {
    await cleanup(household.id);
  }
});

test("upsertFixedGrocery overschrijft i.p.v. dupliceert (unieke index per ingrediënt)", async () => {
  const melk = await prisma.ingredient.findUniqueOrThrow({ where: { name: "Melk" } });
  const household = await makeHousehold("WP2 integratietest — upsert");

  try {
    await upsertFixedGrocery(household.id, melk.id, 1000, "ML");
    await upsertFixedGrocery(household.id, melk.id, 500, "ML");

    const fixed = await getFixedGroceries(household.id);
    assert.equal(fixed.length, 1);
    assert.equal(fixed[0].quantity, 500);
  } finally {
    await cleanup(household.id);
  }
});

test("removeFixedGrocery verwijdert de standaard, maar niet meteen een reeds gegenereerde lijst", async () => {
  const melk = await prisma.ingredient.findUniqueOrThrow({ where: { name: "Melk" } });
  const household = await makeHousehold("WP2 integratietest — verwijderen");

  try {
    await upsertFixedGrocery(household.id, melk.id, 1000, "ML");
    const mealPlan = await ensureMealPlan(household.id, getCurrentWeekStart());
    await ensureShoppingList(mealPlan!.id, household.id);

    await removeFixedGrocery(household.id, melk.id);
    const fixed = await getFixedGroceries(household.id);
    assert.equal(fixed.length, 0);

    const available = await getIngredientsWithoutFixedGrocery(household.id);
    assert.ok(available.some((i) => i.id === melk.id));
  } finally {
    await cleanup(household.id);
  }
});
