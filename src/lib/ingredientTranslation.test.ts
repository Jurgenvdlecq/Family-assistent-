import test from "node:test";
import assert from "node:assert/strict";
import { translateIngredientTextToDutch } from "./ingredientTranslation";
import { parseRecipeIngredientText, inferRecipeIngredientCategory } from "./recipeIngredientText";

test("translateIngredientTextToDutch vertaalt meerwoordsfrases vóór losse woorden", () => {
  assert.equal(translateIngredientTextToDutch("2 chicken breasts"), "2 kipfilet");
  assert.equal(translateIngredientTextToDutch("1 cup coconut milk"), "1 cup kokosmelk");
});

test("translateIngredientTextToDutch vertaalt losse bekende woorden", () => {
  assert.equal(translateIngredientTextToDutch("1 onion, chopped"), "1 ui, chopped");
  assert.equal(translateIngredientTextToDutch("2 eggs"), "2 eieren");
});

test("translateIngredientTextToDutch laat onbekende woorden en eenheden ongemoeid", () => {
  assert.equal(translateIngredientTextToDutch("1 tbsp diced shallots"), "1 tbsp diced shallots");
});

test("translateIngredientTextToDutch is hoofdletterongevoelig", () => {
  assert.equal(translateIngredientTextToDutch("Chicken Breast"), "kipfilet");
});

test("vertaalde Engelse ingrediëntregel krijgt na parsing de juiste categorie", () => {
  const translated = translateIngredientTextToDutch("2 chicken breasts");
  const parsed = parseRecipeIngredientText(translated);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, "Kipfilet");
  assert.equal(inferRecipeIngredientCategory(parsed[0].name), "MEAT");
});

test("vertaling + eenheidsomrekening werken samen bij een geïmporteerde regel", () => {
  const translated = translateIngredientTextToDutch("1 cup coconut milk");
  const parsed = parseRecipeIngredientText(translated);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, "Kokosmelk");
  assert.equal(parsed[0].quantity, 240);
  assert.equal(parsed[0].unit, "ML");
  assert.equal(inferRecipeIngredientCategory(parsed[0].name), "DAIRY");
});
