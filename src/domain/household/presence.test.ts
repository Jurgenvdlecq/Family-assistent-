import assert from "node:assert/strict";
import test from "node:test";
import {
  calculatePortionScaleForDate,
  calculatePortionScaleForDay,
  calculatePortionScaleForWeek,
  defaultPortionMultiplierForRole,
  getPresentPersonsForDate,
  getPresentPersonsForDay,
  isPersonPresentOnDate,
  isPersonPresentOnDay,
  type PersonPresenceInput,
} from "./presence";

const persons: PersonPresenceInput[] = [
  {
    id: "parent",
    name: "Ouder",
    defaultPresent: true,
    portionMultiplier: 1,
    presenceOverrides: [],
  },
  {
    id: "child",
    name: "Kind",
    defaultPresent: true,
    portionMultiplier: 0.7,
    presenceOverrides: [{ dayOfWeek: "TUESDAY", present: false }],
  },
  {
    id: "guest",
    name: "Logee",
    defaultPresent: false,
    portionMultiplier: 1,
    presenceOverrides: [{ dayOfWeek: "FRIDAY", present: true }],
  },
];

test("presence overrides win from default presence", () => {
  assert.equal(isPersonPresentOnDay(persons[1], "monday"), true);
  assert.equal(isPersonPresentOnDay(persons[1], "tuesday"), false);
  assert.equal(isPersonPresentOnDay(persons[2], "friday"), true);
});

test("present persons are resolved per day", () => {
  assert.deepEqual(
    getPresentPersonsForDay(persons, "tuesday").map((person) => person.id),
    ["parent"]
  );
  assert.deepEqual(
    getPresentPersonsForDay(persons, "friday").map((person) => person.id),
    ["parent", "child", "guest"]
  );
});

test("portion scale is relative to normal household presence", () => {
  assert.equal(calculatePortionScaleForDay(persons, "monday").scale, 1);
  assert.equal(calculatePortionScaleForDay(persons, "tuesday").scale, 1 / 1.7);
  assert.equal(calculatePortionScaleForDay(persons, "friday").scale, 2.7 / 1.7);
});

test("children get a smaller default portion", () => {
  assert.equal(defaultPortionMultiplierForRole("PARENT"), 1);
  assert.equal(defaultPortionMultiplierForRole("CHILD"), 0.7);
  assert.equal(defaultPortionMultiplierForRole("OTHER"), 1);
});

// ── Weekritme: oneven/even en datum-uitzonderingen ──────────────────────────
//
// Alle datums hieronder komen uit september 2026:
//   ma 7 t/m zo 13  → ISO-week 37 (oneven)
//   ma 14 t/m zo 20 → ISO-week 38 (even)
const ODD_WEEK_START = new Date(2026, 8, 7);
const EVEN_WEEK_START = new Date(2026, 8, 14);
const ODD_FRIDAY = new Date(2026, 8, 11);
const EVEN_FRIDAY = new Date(2026, 8, 18);
const ODD_SATURDAY = new Date(2026, 8, 12);
const EVEN_SATURDAY = new Date(2026, 8, 19);
const ODD_MONDAY = new Date(2026, 8, 7);
const ODD_WEDNESDAY = new Date(2026, 8, 9);
const ODD_SUNDAY = new Date(2026, 8, 13);

/**
 * Het huishouden uit de opdracht: ma/di/zo met z'n vieren, wo/do met z'n
 * tweeën, en vr/za afwisselend vier (oneven week) of twee (even week).
 */
function rhythmHousehold(): PersonPresenceInput[] {
  const alwaysThere = (id: string, name: string, portionMultiplier: number): PersonPresenceInput => ({
    id,
    name,
    defaultPresent: true,
    portionMultiplier,
    presenceOverrides: [],
  });
  const child = (id: string, name: string): PersonPresenceInput => ({
    ...alwaysThere(id, name, 0.7),
    presenceOverrides: [
      { dayOfWeek: "WEDNESDAY", present: false },
      { dayOfWeek: "THURSDAY", present: false },
      { dayOfWeek: "FRIDAY", present: false, weekParity: "EVEN" },
      { dayOfWeek: "SATURDAY", present: false, weekParity: "EVEN" },
    ],
  });
  return [
    alwaysThere("jurgen", "Jurgen", 1),
    alwaysThere("ellen", "Ellen", 1),
    child("lynn", "Lynn"),
    child("kai", "Kai"),
  ];
}

test("weekritme: vaste dagen zijn elke week gelijk", () => {
  const persons = rhythmHousehold();
  for (const [label, date] of [
    ["maandag", ODD_MONDAY],
    ["zondag", ODD_SUNDAY],
  ] as const) {
    assert.equal(getPresentPersonsForDate(persons, date).length, 4, `${label} eet het hele gezin mee`);
  }
  assert.equal(
    getPresentPersonsForDate(persons, ODD_WEDNESDAY).map((person) => person.id).join(","),
    "jurgen,ellen",
    "woensdag eten alleen de volwassenen mee, ongeacht de weeksoort"
  );
});

test("weekritme: vrijdag en zaterdag volgen het oneven/even-ritme", () => {
  const persons = rhythmHousehold();
  assert.equal(getPresentPersonsForDate(persons, ODD_FRIDAY).length, 4, "oneven vrijdag: met z'n vieren");
  assert.equal(getPresentPersonsForDate(persons, EVEN_FRIDAY).length, 2, "even vrijdag: met z'n tweeën");
  assert.equal(getPresentPersonsForDate(persons, ODD_SATURDAY).length, 4, "oneven zaterdag: met z'n vieren");
  assert.equal(getPresentPersonsForDate(persons, EVEN_SATURDAY).length, 2, "even zaterdag: met z'n tweeën");
});

/**
 * De porties worden opgeteld als kommagetallen (1 + 1 + 0,7 + 0,7 wordt in
 * drijvendekommarekenen 3,4000000000000004), dus vergelijken op de laatste
 * bit heeft geen betekenis. Een marge van 1e-9 is ruim onder alles wat aan
 * boodschappen merkbaar zou zijn.
 */
function assertScale(actual: number, expected: number, message: string) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${message} (verwacht ~${expected}, kreeg ${actual})`
  );
}

test("weekritme: dezelfde weekdag krijgt in twee weken een andere portieschaling", () => {
  const persons = rhythmHousehold();
  // Basis = iedereen die standaard mee-eet: 1 + 1 + 0,7 + 0,7 = 3,4.
  assertScale(calculatePortionScaleForDate(persons, ODD_FRIDAY).scale, 1, "oneven vrijdag: het hele gezin");
  assertScale(calculatePortionScaleForDate(persons, EVEN_FRIDAY).scale, 2 / 3.4, "even vrijdag: twee van de 3,4 porties");
});

test("weekritme: een pariteitsregel wint van de regel die elke week geldt", () => {
  const person: PersonPresenceInput = {
    id: "kai",
    name: "Kai",
    defaultPresent: true,
    portionMultiplier: 1,
    presenceOverrides: [
      { dayOfWeek: "FRIDAY", present: true, weekParity: "EVERY" },
      { dayOfWeek: "FRIDAY", present: false, weekParity: "EVEN" },
    ],
  };
  assert.equal(isPersonPresentOnDate(person, ODD_FRIDAY), true, "oneven week: de algemene regel geldt");
  assert.equal(isPersonPresentOnDate(person, EVEN_FRIDAY), false, "even week: de specifieke regel wint");
});

test("weekritme: een regel zonder pariteit gedraagt zich als 'elke week'", () => {
  // Dit is het pad voor alle rijen van vóór het weekritme.
  const person: PersonPresenceInput = {
    id: "logee",
    name: "Logee",
    defaultPresent: false,
    portionMultiplier: 1,
    presenceOverrides: [{ dayOfWeek: "FRIDAY", present: true }],
  };
  assert.equal(isPersonPresentOnDate(person, ODD_FRIDAY), true);
  assert.equal(isPersonPresentOnDate(person, EVEN_FRIDAY), true);
});

test("weekritme: een datum-uitzondering wint van het patroon", () => {
  const persons = rhythmHousehold();
  const [, , lynn] = persons;
  lynn.presenceDateOverrides = [{ date: ODD_FRIDAY, present: false }];

  assert.equal(
    getPresentPersonsForDate(persons, ODD_FRIDAY).length,
    3,
    "deze ene oneven vrijdag eet Lynn niet mee"
  );
  assert.equal(
    getPresentPersonsForDate(persons, new Date(2026, 8, 25)).length,
    4,
    "de oneven vrijdag twee weken later volgt gewoon weer het patroon"
  );
  assert.equal(
    lynn.presenceOverrides.filter((override) => override.dayOfWeek === "FRIDAY").length,
    1,
    "de uitzondering heeft het patroon zelf niet aangepast"
  );
});

test("weekritme: een datum-uitzondering kan iemand ook juist toevoegen", () => {
  const persons = rhythmHousehold();
  const [, , , kai] = persons;
  kai.presenceDateOverrides = [{ date: EVEN_SATURDAY, present: true }];
  assert.equal(
    getPresentPersonsForDate(persons, EVEN_SATURDAY).map((person) => person.id).join(","),
    "jurgen,ellen,kai"
  );
});

test("weekritme: portieschaling voor een hele week gebruikt de datums van díé week", () => {
  const persons = rhythmHousehold();
  const oddWeek = calculatePortionScaleForWeek(persons, ODD_WEEK_START);
  const evenWeek = calculatePortionScaleForWeek(persons, EVEN_WEEK_START);

  assert.equal(oddWeek.monday.scale, evenWeek.monday.scale, "maandag verandert niet");
  assertScale(oddWeek.friday.scale, 1, "oneven vrijdag");
  assertScale(evenWeek.friday.scale, 2 / 3.4, "even vrijdag");
});

test("weekritme: isPersonPresentOnDay kijkt bewust alleen naar het patroon van elke week", () => {
  // Dit pad hoort bij schermen die het verwachte ritme tonen zonder dat er
  // een concrete week bij hoort — het mag daar niet ineens de even week gaan
  // tonen omdat het toevallig een even week is.
  const person: PersonPresenceInput = {
    id: "kai",
    name: "Kai",
    defaultPresent: true,
    portionMultiplier: 1,
    presenceOverrides: [{ dayOfWeek: "FRIDAY", present: false, weekParity: "EVEN" }],
  };
  assert.equal(isPersonPresentOnDay(person, "friday"), true);
});
