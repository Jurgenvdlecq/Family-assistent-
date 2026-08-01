/**
 * Integratietest tegen een echte (lokale) Postgres — dekt specifiek de
 * huishoudbrede harde regel (MEAL_PLANNING_GAP_PLAN.md, wens 2: "geen vis"),
 * die los van een individuele persoonsbeperking op `Household.hardRestrictions`
 * staat. `collectHardRestrictions` is bewust niet geëxporteerd (intern
 * detail), dus getest via de publieke functies die 'm gebruiken.
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { getHouseholdHardRestrictions, getHouseholdHardRestrictionsAndParticipantsByDay } from "./household";

async function cleanup(householdId: string) {
  await prisma.person.deleteMany({ where: { householdId } });
  await prisma.household.delete({ where: { id: householdId } });
}

test("getHouseholdHardRestrictions: een huishoudbrede regel geldt ook zonder dat een persoon 'm heeft", async () => {
  const household = await prisma.household.create({
    data: {
      name: "WP-uit-eten-vervolg — huishoudregel",
      hardRestrictions: ["vis"],
      persons: { create: [{ name: "Test", role: "PARENT", hardRestrictions: [], defaultPresent: true }] },
    },
  });

  try {
    const restrictions = await getHouseholdHardRestrictions(household.id);
    assert.deepEqual(restrictions, ["vis"], "de huishoudregel moet meetellen, ook al heeft geen enkel gezinslid deze zelf");
  } finally {
    await cleanup(household.id);
  }
});

test("getHouseholdHardRestrictions: huishoudregel en persoonsbeperking worden samengevoegd zonder duplicaten", async () => {
  const household = await prisma.household.create({
    data: {
      name: "WP-uit-eten-vervolg — samenvoegen",
      hardRestrictions: ["vis"],
      persons: { create: [{ name: "Test", role: "PARENT", hardRestrictions: ["vis", "pinda"], defaultPresent: true }] },
    },
  });

  try {
    const restrictions = await getHouseholdHardRestrictions(household.id);
    assert.deepEqual(
      [...restrictions].sort(),
      ["pinda", "vis"],
      "de gecombineerde lijst moet uniek zijn, ook als huishoud- en persoonsregel elkaar overlappen"
    );
  } finally {
    await cleanup(household.id);
  }
});

test("getHouseholdHardRestrictionsAndParticipantsByDay: huishoudregel geldt voor elke dag, ongeacht wie er mee-eet", async () => {
  const household = await prisma.household.create({
    data: {
      name: "WP-uit-eten-vervolg — per dag",
      hardRestrictions: ["vis"],
      persons: { create: [{ name: "Test", role: "PARENT", hardRestrictions: [], defaultPresent: false }] },
    },
  });

  try {
    const { hardRestrictionsByDay } = await getHouseholdHardRestrictionsAndParticipantsByDay(household.id);
    assert.deepEqual(
      hardRestrictionsByDay.monday,
      ["vis"],
      "de huishoudregel geldt ook op een dag waarop de enige persoon niet standaard mee-eet"
    );
  } finally {
    await cleanup(household.id);
  }
});
