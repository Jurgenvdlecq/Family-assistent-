import test from "node:test";
import assert from "node:assert/strict";
import { parseMealWish, scoreMealWish, tagsForMealCandidate } from "./mealTags";

const ingredients = [
  { id: "kip", name: "Kipfilet" },
  { id: "sperziebonen", name: "Sperziebonen" },
  { id: "aardappel", name: "Aardappelen" },
  { id: "pasta", name: "Pasta" },
];

test("parseMealWish herkent AVG, kip en sperziebonen uit natuurlijke tekst", () => {
  const wish = parseMealWish("We hebben trek in AVG met sperziebonen en kip", ingredients);

  assert.deepEqual(wish.tags, ["AVG"]);
  assert.deepEqual(wish.ingredientIds, ["kip", "sperziebonen"]);
});

test("tagsForMealCandidate leidt AVG af uit aardappel/groente/proteine", () => {
  const tags = tagsForMealCandidate({
    recipeCategory: "OTHER",
    recipeProperties: [],
    variantType: "FRESH",
    contextFit: [],
    ingredients: ingredients.slice(0, 3),
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
      ingredients: [ingredients[0], ingredients[1], ingredients[2]],
    },
    wish
  );

  assert.equal(score.score, 60);
  assert.deepEqual(score.missing, []);
});
