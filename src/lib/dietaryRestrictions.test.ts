import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRestriction,
  resolveRestrictions,
  recipeConflictsWithRestrictions,
} from "./dietaryRestrictions";

test("normalizeRestriction strips case, whitespace, apostrophes and accents", () => {
  assert.equal(normalizeRestriction("Pinda's"), "pindas");
  assert.equal(normalizeRestriction("  Lactose-intolerant "), "lactoseintolerant");
  assert.equal(normalizeRestriction("Coëliakie"), "coeliakie");
});

test("geen restricties -> nooit een conflict", () => {
  const conflict = recipeConflictsWithRestrictions(
    [{ category: "MEAT", restrictionTags: [] }],
    []
  );
  assert.equal(conflict, false);
});

test("directe tag-match sluit het recept uit", () => {
  const ingredients = [{ category: "PANTRY", restrictionTags: ["noten"] }];
  assert.equal(recipeConflictsWithRestrictions(ingredients, ["noten"]), true);
});

test("recept zonder overlappende tags blijft veilig", () => {
  const ingredients = [{ category: "VEGETABLE", restrictionTags: [] }];
  assert.equal(recipeConflictsWithRestrictions(ingredients, ["noten"]), false);
});

test("alias-resolutie: \"pinda's\" matcht de pinda-tag", () => {
  const { tags } = resolveRestrictions(["Pinda's"]);
  assert.deepEqual([...tags], ["pinda"]);
  const ingredients = [{ category: "PANTRY", restrictionTags: ["pinda"] }];
  assert.equal(recipeConflictsWithRestrictions(ingredients, ["Pinda's"]), true);
});

test("vegetarisch sluit vlees en vis uit, maar niet zuivel", () => {
  const meat = [{ category: "MEAT", restrictionTags: [] }];
  const fish = [{ category: "FISH", restrictionTags: [] }];
  const dairy = [{ category: "DAIRY", restrictionTags: [] }];
  assert.equal(recipeConflictsWithRestrictions(meat, ["vegetarisch"]), true);
  assert.equal(recipeConflictsWithRestrictions(fish, ["vegetarisch"]), true);
  assert.equal(recipeConflictsWithRestrictions(dairy, ["vegetarisch"]), false);
});

test("veganistisch sluit ook zuivel uit", () => {
  const dairy = [{ category: "DAIRY", restrictionTags: [] }];
  assert.equal(recipeConflictsWithRestrictions(dairy, ["veganistisch"]), true);
});

test("meerdere gezinsleden: restricties worden gecombineerd (union)", () => {
  const ingredients = [{ category: "FISH", restrictionTags: ["vis"] }];
  // Persoon A heeft "noten", persoon B heeft "vis" — het recept moet
  // uitgesloten worden zodra ook maar één van beiden erdoor geraakt wordt.
  assert.equal(recipeConflictsWithRestrictions(ingredients, ["noten", "vis"]), true);
});

test("onherkende restrictietekst sluit niets uit, maar wordt gerapporteerd als unmatched", () => {
  const { unmatched, tags, vegetarian, vegan } = resolveRestrictions(["glutenvrije haver-onzin"]);
  assert.equal(unmatched.length, 1);
  assert.equal(tags.size, 0);
  assert.equal(vegetarian, false);
  assert.equal(vegan, false);
});

test("lege of alleen-witruimte restricties worden genegeerd", () => {
  const { tags, unmatched } = resolveRestrictions(["", "   "]);
  assert.equal(tags.size, 0);
  assert.equal(unmatched.length, 0);
});

test("lege kandidatenpool na filteren is het probleem van de aanroeper, niet van deze pure functie", () => {
  // Deze module beslist alleen per-recept; de aanroeper (ensureMealPlan)
  // moet zelf besluiten wat te doen als alles wegvalt.
  const ingredients = [{ category: "MEAT", restrictionTags: [] }];
  assert.equal(recipeConflictsWithRestrictions(ingredients, ["vegetarisch"]), true);
});
