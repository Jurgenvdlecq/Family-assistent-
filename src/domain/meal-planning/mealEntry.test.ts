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
