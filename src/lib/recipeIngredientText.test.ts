import test from "node:test";
import assert from "node:assert/strict";
import { parseRecipeIngredientText } from "./recipeIngredientText";

test("parseRecipeIngredientText herkent gram, ml en stuks", () => {
  const parsed = parseRecipeIngredientText("400g kipfilet\n300 gram rijst\n2 paprika\n1 liter bouillon");

  assert.deepEqual(
    parsed.map((line) => ({ name: line.name, quantity: line.quantity, unit: line.unit })),
    [
      { name: "Kipfilet", quantity: 400, unit: "GRAM" },
      { name: "Rijst", quantity: 300, unit: "GRAM" },
      { name: "Paprika", quantity: 2, unit: "PIECE" },
      { name: "Bouillon", quantity: 1000, unit: "ML" },
    ]
  );
});

test("parseRecipeIngredientText combineert dubbele ingredienten met dezelfde eenheid", () => {
  const parsed = parseRecipeIngredientText("200g kipfilet, 300 gram kipfilet");

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, "Kipfilet");
  assert.equal(parsed[0].quantity, 500);
  assert.equal(parsed[0].unit, "GRAM");
});

test("parseRecipeIngredientText haalt verpakkingswoorden uit de zoeknaam", () => {
  const parsed = parseRecipeIngredientText("1 pak rijst\n2 zakken aardappelblokjes");

  assert.deepEqual(
    parsed.map((line) => ({ name: line.name, quantity: line.quantity, unit: line.unit })),
    [
      { name: "Rijst", quantity: 1, unit: "PIECE" },
      { name: "Aardappelblokjes", quantity: 2, unit: "PIECE" },
    ]
  );
});

test("parseRecipeIngredientText herkent Amerikaanse maateenheden en zet ze om naar gram/ml", () => {
  const parsed = parseRecipeIngredientText(
    "1 cup kokosmelk\n2 tbsp sojasaus\n1 tsp zout\n8 oz kipfilet\n1 lb rundergehakt"
  );

  assert.deepEqual(
    parsed.map((line) => ({ name: line.name, quantity: line.quantity, unit: line.unit })),
    [
      { name: "Kokosmelk", quantity: 240, unit: "ML" },
      { name: "Sojasaus", quantity: 30, unit: "ML" },
      { name: "Zout", quantity: 5, unit: "ML" },
      { name: "Kipfilet", quantity: 224, unit: "GRAM" },
      { name: "Rundergehakt", quantity: 454, unit: "GRAM" },
    ]
  );
});

test("parseRecipeIngredientText negeert persoon-prefixen bij losse maaltijden", () => {
  const parsed = parseRecipeIngredientText("Kai: frikandel\nLynn: kaasstengels\nEllen: Carrero, mini kaassouffle");

  assert.deepEqual(
    parsed.map((line) => ({ name: line.name, quantity: line.quantity, unit: line.unit })),
    [
      { name: "Frikandel", quantity: 1, unit: "PIECE" },
      { name: "Kaasstengels", quantity: 1, unit: "PIECE" },
      { name: "Carrero", quantity: 1, unit: "PIECE" },
      { name: "Mini Kaassouffle", quantity: 1, unit: "PIECE" },
    ]
  );
});
