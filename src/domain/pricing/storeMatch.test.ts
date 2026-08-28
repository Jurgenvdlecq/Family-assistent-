import { test } from "node:test";
import assert from "node:assert/strict";
import { rankStoreProducts, scoreStoreProductForIngredient } from "./storeMatch";
import type { ProviderProduct } from "./types";

function product(name: string, overrides: Partial<ProviderProduct> = {}): ProviderProduct {
  return {
    provider: "AH",
    externalRef: name.toLowerCase().replace(/\W+/g, "-"),
    name,
    brand: "AH",
    packageSize: "1 l",
    content: { amount: 1000, unit: "ML" },
    price: 1.29,
    wasPrice: null,
    unitPrice: null,
    promoType: "GEEN",
    promoLabel: null,
    promoUntil: null,
    gtin: null,
    labels: [],
    freeFromAllergens: [],
    imageId: null,
    ...overrides,
  };
}

test("een product dat het ingrediënt volledig noemt scoort vol", () => {
  assert.equal(scoreStoreProductForIngredient("Halfvolle melk", "AH Halfvolle melk"), 1);
});

test("de winkelnaam telt niet mee als betekenisdragend woord", () => {
  // Anders zou "AH" in elke productnaam de score kunstmatig verhogen.
  assert.equal(scoreStoreProductForIngredient("Melk", "AH Halfvolle melk"), 1);
});

test("een half passend product komt onder de drempel", () => {
  const score = scoreStoreProductForIngredient("Verse gember", "Gemberkoek");
  assert.ok(score < 1, `verwacht een lagere score, kreeg ${score}`);
});

test("een compleet ander product scoort nul", () => {
  assert.equal(scoreStoreProductForIngredient("Kipfilet", "Bloemkool"), 0);
});

test("rankStoreProducts laat producten onder de drempel weg", () => {
  // Liever geen match dan een verkeerde: een niet-gevonden regel wordt
  // zichtbaar getoond, een verkeerde match verdwijnt in een totaalbedrag.
  const matches = rankStoreProducts("Halfvolle melk", [
    product("AH Halfvolle melk"),
    product("AH Volle melk"),
    product("Bloemkool"),
  ]);
  assert.deepEqual(
    matches.map((match) => match.product.name),
    ["AH Halfvolle melk"]
  );
});

test("rankStoreProducts geeft meerdere kandidaten terug, kleinste verpakking eerst", () => {
  // Meerdere, omdat het equivalentiemodel straks moet kunnen kiezen tussen
  // "zelfde soort" en "goedkoper alternatief".
  const matches = rankStoreProducts("Halfvolle melk", [
    product("AH Halfvolle melk", { externalRef: "groot", content: { amount: 2000, unit: "ML" } }),
    product("AH Halfvolle melk", { externalRef: "klein", content: { amount: 1000, unit: "ML" } }),
    product("AH Biologische halfvolle melk", { externalRef: "bio" }),
  ]);
  assert.equal(matches.length, 3);
  assert.equal(matches[0].product.externalRef, "klein", "de gewone verpakking staat voorop");
});

test("rankStoreProducts is deterministisch bij gelijke score en gelijke inhoud", () => {
  const options = [
    product("AH Halfvolle melk", { externalRef: "z" }),
    product("AH Halfvolle melk", { externalRef: "a" }),
  ];
  assert.equal(rankStoreProducts("Halfvolle melk", options)[0].product.externalRef, "a");
  assert.equal(rankStoreProducts("Halfvolle melk", [...options].reverse())[0].product.externalRef, "a");
});
