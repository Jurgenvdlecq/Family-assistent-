import assert from "node:assert/strict";
import test from "node:test";
import {
  calculatePortionScaleForDay,
  defaultPortionMultiplierForRole,
  getPresentPersonsForDay,
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
