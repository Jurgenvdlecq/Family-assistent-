import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMealDayRule } from "./mealDayRules";
import { DAY_PROFILES, dayProfile, isDayProfileKey } from "./dayProfiles";

// Vrijdag 11 september 2026 zit in ISO-week 37 (oneven), vrijdag 18 september
// in week 38 (even).
const ODD_FRIDAY = new Date(2026, 8, 11);
const EVEN_FRIDAY = new Date(2026, 8, 18);

const everyFriday = { dayOfWeek: "FRIDAY", weekParity: "EVERY" as const, profileKey: "FAMILY_AVG_ROTATION" };
const evenFriday = { dayOfWeek: "FRIDAY", weekParity: "EVEN" as const, profileKey: "ADULT_EASY" };
const everyMonday = { dayOfWeek: "MONDAY", weekParity: "EVERY" as const, profileKey: "BUSY_EARLY_REHEATABLE" };

test("resolveMealDayRule: zonder regels is er niets, en blijft de planner zich gedragen zoals voorheen", () => {
  assert.equal(resolveMealDayRule([], "FRIDAY", ODD_FRIDAY), null);
});

test("resolveMealDayRule: de regel voor de weeksoort wint van de regel voor elke week", () => {
  const rules = [everyFriday, evenFriday, everyMonday];
  assert.equal(resolveMealDayRule(rules, "FRIDAY", EVEN_FRIDAY)?.profileKey, "ADULT_EASY");
  assert.equal(resolveMealDayRule(rules, "FRIDAY", ODD_FRIDAY)?.profileKey, "FAMILY_AVG_ROTATION");
});

test("resolveMealDayRule: een regel voor één weeksoort geldt niet in de andere", () => {
  assert.equal(resolveMealDayRule([evenFriday], "FRIDAY", EVEN_FRIDAY)?.profileKey, "ADULT_EASY");
  assert.equal(
    resolveMealDayRule([evenFriday], "FRIDAY", ODD_FRIDAY),
    null,
    "in een oneven week is er dan simpelweg geen regel"
  );
});

test("resolveMealDayRule: regels van een andere dag doen niet mee", () => {
  assert.equal(resolveMealDayRule([everyMonday], "FRIDAY", ODD_FRIDAY), null);
});

test("dayProfile: een onbekende of lege sleutel is geen fout maar 'geen profiel'", () => {
  assert.equal(dayProfile(null), null);
  assert.equal(dayProfile(""), null);
  assert.equal(dayProfile("BESTAAT_NIET"), null);
  assert.equal(dayProfile("ADULT_EASY")?.label, "Makkelijk, met z'n tweeën");
});

test("dayProfiles: alle profielen uit de opdracht bestaan", () => {
  for (const key of [
    "BUSY_EARLY_REHEATABLE",
    "FAMILY_AVG_ROTATION",
    "ADULT_RICE_CHICKEN",
    "ADULT_TAKEAWAY_REPLACEMENT",
    "ADULT_EASY",
    "FAMILY_EASY",
    "ADULT_FLEX",
    "FIXED",
  ]) {
    assert.ok(isDayProfileKey(key), `profiel ontbreekt: ${key}`);
  }
});

test("dayProfiles: alleen FIXED belooft dat er niets vanzelf verandert", () => {
  const fixedProfiles = Object.values(DAY_PROFILES).filter((profile) => profile.fixed);
  assert.deepEqual(
    fixedProfiles.map((profile) => profile.key),
    ["FIXED"]
  );
});

test("dayProfiles: elk profiel heeft een label en een uitleg, want ze komen in de UI", () => {
  for (const profile of Object.values(DAY_PROFILES)) {
    assert.ok(profile.label.length > 0, `${profile.key} mist een label`);
    assert.ok(profile.description.length > 0, `${profile.key} mist een uitleg`);
  }
});
