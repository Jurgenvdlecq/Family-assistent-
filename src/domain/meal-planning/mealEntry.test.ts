import { test } from "node:test";
import assert from "node:assert/strict";
import { isCompositeMealEntry, mealEntryNeeds, mealEntryTitle, type MealEntryLike } from "./mealEntry";

function component(
  name: string,
  ingredientId: string,
  quantityPerPortion: number,
  role: string,
  sortOrder: number,
  unit: "GRAM" | "PIECE" = "GRAM"
) {
  return { option: { name, ingredientId, quantityPerPortion, unit, group: { role, sortOrder } } };
}

const recipeEntry: MealEntryLike = {
  recipeVariant: {
    recipe: {
      title: "Pasta bolognese",
      ingredients: [
        { ingredientId: "pasta", quantity: 500, unit: "GRAM" },
        { ingredientId: "gehakt", quantity: 500, unit: "GRAM" },
      ],
    },
  },
  mealTemplate: null,
  components: [],
};

const compositeEntry: MealEntryLike = {
  recipeVariant: null,
  mealTemplate: { name: "AVG" },
  components: [
    component("Aardappelblokjes", "aardappel", 200, "BASE", 0),
    component("Schnitzel", "schnitzel", 1, "PROTEIN", 1, "PIECE"),
    component("Broccoli", "broccoli", 150, "VEGETABLE", 2),
  ],
};

test("mealEntryTitle: een recept houdt gewoon zijn eigen titel", () => {
  assert.equal(mealEntryTitle(recipeEntry), "Pasta bolognese");
  assert.equal(isCompositeMealEntry(recipeEntry), false);
});

test("mealEntryTitle: een samenstelling wordt genoemd naar het eiwitcomponent", () => {
  assert.equal(mealEntryTitle(compositeEntry), "Schnitzel met aardappelblokjes en broccoli");
  assert.equal(isCompositeMealEntry(compositeEntry), true);
});

test("mealEntryTitle: zonder eiwitcomponent begint de naam gewoon bij het eerste onderdeel", () => {
  const entry: MealEntryLike = {
    recipeVariant: null,
    mealTemplate: { name: "AVG" },
    components: [
      component("Aardappelblokjes", "aardappel", 200, "BASE", 0),
      component("Broccoli", "broccoli", 150, "VEGETABLE", 2),
    ],
  };
  assert.equal(mealEntryTitle(entry), "Aardappelblokjes met broccoli");
});

test("mealEntryTitle: een sjabloon zonder gekozen componenten belooft niets wat er niet is", () => {
  const entry: MealEntryLike = { recipeVariant: null, mealTemplate: { name: "AVG" }, components: [] };
  assert.equal(mealEntryTitle(entry), "AVG");
});

test("mealEntryNeeds: recepthoeveelheden schalen mee met de aanwezigheid", () => {
  const needs = mealEntryNeeds(recipeEntry, { scale: 0.5, presentPortions: 2 });
  assert.deepEqual(needs, [
    { ingredientId: "pasta", quantity: 250, unit: "GRAM" },
    { ingredientId: "gehakt", quantity: 250, unit: "GRAM" },
  ]);
});

test("mealEntryNeeds: componenthoeveelheden staan per persoon en tellen dus met de porties op", () => {
  // Vier eters: 4 × 200 g aardappel, 4 schnitzels, 4 × 150 g broccoli.
  const needs = mealEntryNeeds(compositeEntry, { scale: 1, presentPortions: 4 });
  assert.deepEqual(needs, [
    { ingredientId: "aardappel", quantity: 800, unit: "GRAM" },
    { ingredientId: "schnitzel", quantity: 4, unit: "PIECE" },
    { ingredientId: "broccoli", quantity: 600, unit: "GRAM" },
  ]);
});

test("mealEntryNeeds: twee eters halveren de samenstelling", () => {
  const needs = mealEntryNeeds(compositeEntry, { scale: 0.5, presentPortions: 2 });
  assert.equal(needs.find((need) => need.ingredientId === "aardappel")?.quantity, 400);
  assert.equal(needs.find((need) => need.ingredientId === "schnitzel")?.quantity, 2);
});

test("mealEntryNeeds: hetzelfde ingrediënt uit twee componenten wordt één regel", () => {
  // Anders zou "aardappel" twee keer op de boodschappenlijst komen en zou de
  // tekortcontrole op de verkeerde hoeveelheid rekenen.
  const entry: MealEntryLike = {
    recipeVariant: null,
    mealTemplate: { name: "Dubbel aardappel" },
    components: [
      component("Aardappelblokjes", "aardappel", 150, "BASE", 0),
      component("Aardappelpartjes", "aardappel", 50, "SIDE", 1),
    ],
  };
  const needs = mealEntryNeeds(entry, { scale: 1, presentPortions: 4 });
  assert.deepEqual(needs, [{ ingredientId: "aardappel", quantity: 800, unit: "GRAM" }]);
});

test("mealEntryNeeds: hetzelfde ingrediënt in een andere eenheid blijft een eigen regel", () => {
  // Gram en stuks kun je niet bij elkaar optellen zonder te weten hoe zwaar
  // één stuk is — dat mag de app niet gokken.
  const entry: MealEntryLike = {
    recipeVariant: null,
    mealTemplate: { name: "Gemengd" },
    components: [
      component("Aardappelblokjes", "aardappel", 150, "BASE", 0, "GRAM"),
      component("Krieltjes", "aardappel", 2, "SIDE", 1, "PIECE"),
    ],
  };
  const needs = mealEntryNeeds(entry, { scale: 1, presentPortions: 2 });
  assert.equal(needs.length, 2);
});

// ── Verdeelde avonden ───────────────────────────────────────────────────────

function assignment(
  label: string,
  fulfillment: string,
  sortOrder: number,
  personIds: string[],
  items: Array<{ ingredientId: string; quantityPerPortion: number; unit: "GRAM" | "PIECE" }> = []
) {
  return { label, fulfillment, sortOrder, persons: personIds.map((personId) => ({ personId })), items };
}

/** De zaterdag uit de opdracht: de kinderen eten bolletjes, de ouders regelen zelf iets. */
const splitEntry: MealEntryLike = {
  recipeVariant: null,
  mealTemplate: null,
  components: [],
  assignments: [
    assignment("Bolletjes met knakworst", "PICNIC", 0, ["lynn", "kai"], [
      { ingredientId: "bolletjes", quantityPerPortion: 2, unit: "PIECE" },
      { ingredientId: "knakworst", quantityPerPortion: 2, unit: "PIECE" },
    ]),
    assignment("Zelf iets regelen", "SELF_PROVIDED", 1, ["jurgen", "ellen"]),
  ],
};

const PORTIONS = {
  scale: 1,
  presentPortions: 3.4,
  personPortions: new Map([
    ["jurgen", 1],
    ["ellen", 1],
    ["lynn", 0.7],
    ["kai", 0.7],
  ]),
};

test("verdeelde avond: de naam laat zien dat er twee dingen op tafel staan", () => {
  assert.equal(mealEntryTitle(splitEntry), "Bolletjes met knakworst · Zelf iets regelen");
});

test("verdeelde avond: alleen de bekende delen leveren boodschappen op", () => {
  const needs = mealEntryNeeds(splitEntry, PORTIONS);
  // Lynn en Kai samen: 0,7 + 0,7 = 1,4 portie, elk 2 stuks.
  assert.deepEqual(needs, [
    { ingredientId: "bolletjes", quantity: 2 * 1.4, unit: "PIECE" },
    { ingredientId: "knakworst", quantity: 2 * 1.4, unit: "PIECE" },
  ]);
});

test("verdeelde avond: een deel dat iemand zelf regelt sluit de rest niet uit", () => {
  // Dit is de kern van de eis: zonder verdeling zou de hele avond wegvallen
  // zodra één deel niets oplevert.
  const needs = mealEntryNeeds(splitEntry, PORTIONS);
  assert.ok(needs.length > 0, "de bolletjes horen gewoon besteld te worden");
});

test("verdeelde avond: iemand die er die dag niet is telt niet mee in de porties", () => {
  const withoutKai = {
    ...PORTIONS,
    personPortions: new Map([
      ["jurgen", 1],
      ["ellen", 1],
      ["lynn", 0.7],
    ]),
  };
  const needs = mealEntryNeeds(splitEntry, withoutKai);
  assert.equal(needs.find((need) => need.ingredientId === "bolletjes")?.quantity, 2 * 0.7);
});

test("verdeelde avond: een deel waar niemand van aanwezig is levert niets op", () => {
  const nobodyPresent = { ...PORTIONS, personPortions: new Map([["jurgen", 1]]) };
  const needs = mealEntryNeeds(splitEntry, nobodyPresent);
  assert.deepEqual(needs, []);
});

test("verdeelde avond: twee delen met hetzelfde ingrediënt worden één regel", () => {
  const entry: MealEntryLike = {
    recipeVariant: null,
    mealTemplate: null,
    components: [],
    assignments: [
      assignment("Pizza salami", "PICNIC", 0, ["jurgen"], [
        { ingredientId: "sla", quantityPerPortion: 50, unit: "GRAM" },
      ]),
      assignment("Tonijnsalade", "PICNIC", 1, ["ellen"], [
        { ingredientId: "sla", quantityPerPortion: 80, unit: "GRAM" },
      ]),
    ],
  };
  const needs = mealEntryNeeds(entry, PORTIONS);
  assert.deepEqual(needs, [{ ingredientId: "sla", quantity: 130, unit: "GRAM" }]);
});

test("verdeelde avond: 'ergens anders kopen' levert wél boodschappen op, alleen niet via Picnic", () => {
  // Het onderscheid tussen OTHER_STORE en SELF_PROVIDED: het eerste moet nog
  // gekocht worden (en dus op de lijst), het tweede niet.
  const entry: MealEntryLike = {
    recipeVariant: null,
    mealTemplate: null,
    components: [],
    assignments: [
      assignment("Biefstuk van de slager", "OTHER_STORE", 0, ["jurgen"], [
        { ingredientId: "biefstuk", quantityPerPortion: 200, unit: "GRAM" },
      ]),
    ],
  };
  assert.deepEqual(mealEntryNeeds(entry, PORTIONS), [
    { ingredientId: "biefstuk", quantity: 200, unit: "GRAM" },
  ]);
});
