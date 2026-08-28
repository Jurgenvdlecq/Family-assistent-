/**
 * Integratietest tegen een echte (lokale) Postgres: leren van herhaalde
 * aanwezigheidscorrecties.
 *
 * De belangrijkste eigenschap die hier bewezen wordt is een negatieve: één
 * correctie — en zelfs twee — verandert het weekritme níét. Dat is precies de
 * eis uit de opdracht, en tegelijk de kant waar een fout duur is: stilzwijgend
 * het patroon aanpassen zou betekenen dat er structureel voor de verkeerde
 * mensen boodschappen worden gedaan.
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { applyPresencePattern, recordPresenceCorrection } from "@/domain/learning/presencePatterns";

async function makeHousehold(name: string) {
  return prisma.household.create({
    data: { name, persons: { create: [{ name: "Kai", role: "CHILD" }] } },
    include: { persons: true },
  });
}

async function cleanup(householdId: string) {
  await prisma.learningPrompt.deleteMany({ where: { householdId } });
  await prisma.learnedPattern.deleteMany({ where: { householdId } });
  await prisma.personPresenceOverride.deleteMany({ where: { person: { householdId } } });
  await prisma.personPresenceDateOverride.deleteMany({ where: { person: { householdId } } });
  await prisma.person.deleteMany({ where: { householdId } });
  await prisma.household.delete({ where: { id: householdId } });
}

function observation(householdId: string, personId: string) {
  return { householdId, personId, personName: "Kai", dayOfWeek: "WEDNESDAY" as const, present: false };
}

test("aanwezigheid leren: twee keer dezelfde correctie levert nog géén vraag op", async () => {
  const household = await makeHousehold("Leren — twee keer is toeval");
  const person = household.persons[0];
  try {
    assert.equal(await recordPresenceCorrection(observation(household.id, person.id)), false);
    assert.equal(await recordPresenceCorrection(observation(household.id, person.id)), false);

    const prompts = await prisma.learningPrompt.findMany({ where: { householdId: household.id } });
    assert.equal(prompts.length, 0, "twee keer kan toeval zijn; daar hoort de app niet naar te vragen");

    const overrides = await prisma.personPresenceOverride.findMany({ where: { personId: person.id } });
    assert.equal(overrides.length, 0, "en het weekritme is sowieso niet aangeraakt");
  } finally {
    await cleanup(household.id);
  }
});

test("aanwezigheid leren: de derde keer levert een vraag op, maar verandert nog niets", async () => {
  const household = await makeHousehold("Leren — derde keer is een vraag");
  const person = household.persons[0];
  try {
    await recordPresenceCorrection(observation(household.id, person.id));
    await recordPresenceCorrection(observation(household.id, person.id));
    const asked = await recordPresenceCorrection(observation(household.id, person.id));
    assert.equal(asked, true);

    const prompts = await prisma.learningPrompt.findMany({ where: { householdId: household.id } });
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].promptType, "CONFIRM_PRESENCE_PATTERN");
    assert.equal(prompts[0].status, "PENDING");

    const overrides = await prisma.personPresenceOverride.findMany({ where: { personId: person.id } });
    assert.equal(
      overrides.length,
      0,
      "een vraag stellen is iets anders dan het antwoord alvast invullen — het ritme blijft ongewijzigd"
    );
  } finally {
    await cleanup(household.id);
  }
});

test("aanwezigheid leren: pas een uitdrukkelijk 'ja' verandert het weekritme", async () => {
  const household = await makeHousehold("Leren — ja zetten");
  const person = household.persons[0];
  try {
    for (let i = 0; i < 3; i += 1) await recordPresenceCorrection(observation(household.id, person.id));
    const prompt = await prisma.learningPrompt.findFirstOrThrow({ where: { householdId: household.id } });

    await applyPresencePattern(household.id, prompt.id);

    const overrides = await prisma.personPresenceOverride.findMany({ where: { personId: person.id } });
    assert.equal(overrides.length, 1);
    assert.equal(overrides[0].dayOfWeek, "WEDNESDAY");
    assert.equal(overrides[0].present, false);
    assert.equal(
      overrides[0].weekParity,
      "EVERY",
      "een gewoonte gaat over elke week; oneven/even afleiden zou te veel geraden zijn"
    );

    const answered = await prisma.learningPrompt.findUniqueOrThrow({ where: { id: prompt.id } });
    assert.equal(answered.status, "ANSWERED");
  } finally {
    await cleanup(household.id);
  }
});

test("aanwezigheid leren: een afgewezen patroon vraagt niet nog eens", async () => {
  const household = await makeHousehold("Leren — nee is een antwoord");
  const person = household.persons[0];
  try {
    for (let i = 0; i < 3; i += 1) await recordPresenceCorrection(observation(household.id, person.id));
    const pattern = await prisma.learnedPattern.findFirstOrThrow({ where: { householdId: household.id } });
    await prisma.learnedPattern.update({ where: { id: pattern.id }, data: { status: "DISMISSED" } });
    await prisma.learningPrompt.deleteMany({ where: { householdId: household.id } });

    const askedAgain = await recordPresenceCorrection(observation(household.id, person.id));
    assert.equal(askedAgain, false);
    assert.equal(await prisma.learningPrompt.count({ where: { householdId: household.id } }), 0);
  } finally {
    await cleanup(household.id);
  }
});

test("aanwezigheid leren: 'eet juist wél mee' is een ander patroon dan 'eet niet mee'", async () => {
  // Ze bij elkaar optellen zou onzin zijn: dan zou drie keer heen en weer
  // corrigeren een "gewoonte" worden.
  const household = await makeHousehold("Leren — twee richtingen");
  const person = household.persons[0];
  try {
    await recordPresenceCorrection({ ...observation(household.id, person.id), present: false });
    await recordPresenceCorrection({ ...observation(household.id, person.id), present: true });
    await recordPresenceCorrection({ ...observation(household.id, person.id), present: false });

    const patterns = await prisma.learnedPattern.findMany({ where: { householdId: household.id } });
    assert.equal(patterns.length, 2, "twee losse patronen");
    assert.equal(await prisma.learningPrompt.count({ where: { householdId: household.id } }), 0);
  } finally {
    await cleanup(household.id);
  }
});
