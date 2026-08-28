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
import {
  getHouseholdHardRestrictions,
  getHouseholdHardRestrictionsAndParticipantsForWeek,
  getHouseholdPortionScaleForDate,
} from "./household";
import { dateForDay, getCurrentWeekStart } from "./week";
import { weekParityForDate } from "@/domain/week/isoWeek";

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

test("getHouseholdHardRestrictionsAndParticipantsForWeek: huishoudregel geldt voor elke dag, ongeacht wie er mee-eet", async () => {
  const household = await prisma.household.create({
    data: {
      name: "WP-uit-eten-vervolg — per dag",
      hardRestrictions: ["vis"],
      persons: { create: [{ name: "Test", role: "PARENT", hardRestrictions: [], defaultPresent: false }] },
    },
  });

  try {
    const { hardRestrictionsByDay } = await getHouseholdHardRestrictionsAndParticipantsForWeek(household.id);
    assert.deepEqual(
      hardRestrictionsByDay.monday,
      ["vis"],
      "de huishoudregel geldt ook op een dag waarop de enige persoon niet standaard mee-eet"
    );
  } finally {
    await cleanup(household.id);
  }
});

test("getHouseholdPortionScaleForDate: leest het pariteitspatroon én de datum-uitzondering uit de database", async () => {
  // Deze test zit bewust op de databaselaag: de logica zelf staat in
  // presence.test.ts, maar of de nieuwe kolommen ook daadwerkelijk mee
  // geselecteerd worden, blijkt alleen hier.
  const household = await prisma.household.create({
    data: {
      name: "Weekritme — schaling per datum uit de database",
      persons: {
        create: [
          { name: "Ouder", role: "PARENT", portionMultiplier: 1 },
          { name: "Kind", role: "CHILD", portionMultiplier: 1 },
        ],
      },
    },
    include: { persons: true },
  });

  try {
    const child = household.persons.find((person) => person.name === "Kind")!;
    // Bewust datums ten opzichte van vandaag: een uitzondering wordt alleen
    // vooruit meegeladen (zie DATE_OVERRIDE_LOOKBACK_DAYS), dus een vaste
    // datum in de code zou deze test op termijn stilletjes laten falen.
    const firstFriday = dateForDay(getCurrentWeekStart(), "friday");
    if (firstFriday.getTime() < Date.now()) firstFriday.setDate(firstFriday.getDate() + 7);
    const secondFriday = new Date(firstFriday);
    secondFriday.setDate(secondFriday.getDate() + 7);
    const thirdFriday = new Date(firstFriday);
    thirdFriday.setDate(thirdFriday.getDate() + 14);

    // Opeenvolgende weken hebben altijd een verschillende pariteit, dus deze
    // regel raakt precies één van de twee vrijdagen.
    await prisma.personPresenceOverride.create({
      data: {
        personId: child.id,
        dayOfWeek: "FRIDAY",
        weekParity: weekParityForDate(secondFriday),
        present: false,
      },
    });

    const scaleForDate = await getHouseholdPortionScaleForDate(household.id);
    assert.equal(scaleForDate(firstFriday).scale, 1, "de andere weeksoort: allebei aan tafel");
    assert.equal(scaleForDate(secondFriday).scale, 0.5, "de weeksoort van de regel: één van de twee porties");

    // Eén concrete vrijdag waarop het kind er tóch niet is.
    await prisma.personPresenceDateOverride.create({
      data: { personId: child.id, date: firstFriday, present: false },
    });

    const withException = await getHouseholdPortionScaleForDate(household.id);
    assert.equal(withException(firstFriday).scale, 0.5, "de uitzondering geldt voor die ene datum");
    assert.equal(
      withException(thirdFriday).scale,
      1,
      "dezelfde weeksoort twee weken later volgt gewoon weer het patroon"
    );

    const patternRows = await prisma.personPresenceOverride.findMany({ where: { personId: child.id } });
    assert.equal(patternRows.length, 1, "een uitzondering mag het patroon nooit hebben aangepast");
    assert.equal(patternRows[0].weekParity, weekParityForDate(secondFriday));
  } finally {
    await prisma.personPresenceDateOverride.deleteMany({ where: { person: { householdId: household.id } } });
    await prisma.personPresenceOverride.deleteMany({ where: { person: { householdId: household.id } } });
    await cleanup(household.id);
  }
});
