import test from "node:test";
import assert from "node:assert/strict";
import { parseMealWish, scoreMealWish, tagsForMealCandidate } from "./mealTags";

const ingredients = [
  { id: "kip", name: "Kipfilet" },
  { id: "kipworst", name: "Kipworst" },
  { id: "pulled-chicken", name: "Pulled chicken" },
  { id: "kipdijfilet", name: "Kipdijfilet" },
  { id: "sperziebonen", name: "Sperziebonen" },
  { id: "aardappel", name: "Aardappelen" },
  { id: "rijst", name: "Rijst" },
  { id: "paprika", name: "Paprika" },
  { id: "pasta", name: "Pasta" },
];

test("parseMealWish herkent AVG, kip en sperziebonen uit natuurlijke tekst", () => {
  const wish = parseMealWish("We hebben trek in AVG met sperziebonen en kip", ingredients);

  assert.deepEqual(wish.tags, ["AVG"]);
  assert.deepEqual(wish.ingredientIds, ["kip", "sperziebonen"]);
});

test("parseMealWish kiest bij een algemene kipwens maar een kip-ingrediënt", () => {
  const wish = parseMealWish("kip rijst boontjes", ingredients);

  assert.deepEqual(wish.ingredientIds, ["kip", "rijst", "sperziebonen"]);
});

test("parseMealWish respecteert een specifiek kip-ingrediënt", () => {
  const wish = parseMealWish("kipdijfilet rijst paprika", ingredients);

  assert.deepEqual(wish.ingredientIds, ["kipdijfilet", "paprika", "rijst"]);
});

test("parseMealWish laat onbekende receptnaam beschikbaar voor titelzoeken", () => {
  const wish = parseMealWish("kofta", ingredients);

  assert.deepEqual(wish.tags, []);
  assert.deepEqual(wish.ingredientIds, []);
  assert.deepEqual(wish.unknownTerms, ["kofta"]);
});

test("tagsForMealCandidate leidt AVG af uit aardappel/groente/proteine", () => {
  const tags = tagsForMealCandidate({
    recipeCategory: "OTHER",
    recipeProperties: [],
    variantType: "FRESH",
    contextFit: [],
    ingredients: [ingredients[0], ingredients[4], ingredients[5]],
  });

  assert.ok(tags.includes("AVG"));
  assert.ok(tags.includes("NORMAL_EFFORT"));
});

test("scoreMealWish beloont tag- en ingredientmatches", () => {
  const wish = parseMealWish("snel AVG met kip", ingredients);
  const score = scoreMealWish(
    {
      recipeCategory: "ALL_VEGGIE_DAY",
      recipeProperties: ["snel"],
      variantType: "FAST",
      contextFit: ["drukke_dag"],
      ingredients: [ingredients[0], ingredients[4], ingredients[5]],
    },
    wish
  );

  assert.equal(score.score, 60);
  assert.deepEqual(score.missing, []);
});
