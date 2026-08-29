import { test } from "node:test";
import assert from "node:assert/strict";
import { rankStoreProducts, scoreStoreProductForIngredient, storeSearchTerm } from "./storeMatch";
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
    url: null,
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

test("zoeken: de naam van een andere winkel telt niet mee in de match", () => {
  // Uit productiegebruik: onze ingrediënten heten "Picnic Appelmoes". Zonder
  // "picnic" als ruiswoord haalde "AH Appelmoes" de drempel niet, en meldde
  // het scherm "niet gevonden" terwijl het product er gewoon ligt.
  assert.equal(scoreStoreProductForIngredient("Picnic Appelmoes", "AH Appelmoes"), 1);
  assert.equal(storeSearchTerm("Picnic Appelmoes"), "appelmoes");
  assert.equal(storeSearchTerm("Picnic Hagelslag"), "hagelslag");
});

test("zoeken: blijft er niets over, dan zoeken we met de naam zelf", () => {
  // Liever een matige zoekopdracht dan een lege.
  assert.equal(storeSearchTerm("Dirk"), "Dirk");
});

test("zoeken: een samenstelling met of zonder spatie is hetzelfde product", () => {
  // Uit productiegebruik: wij noemen het "Allesreinigerdoekjes", Albert Heijn
  // schrijft "Allesreiniger doekjes". Op letterniveau vond de ene vorm de
  // andere niet, en dan staat er "niet gevonden" terwijl het product er ligt.
  assert.equal(
    scoreStoreProductForIngredient("Allesreinigerdoekjes Citrus", "AH Allesreiniger doekjes citrus"),
    1
  );
  // En andersom net zo goed.
  assert.equal(scoreStoreProductForIngredient("Snack Tomaatjes", "AH Snacktomaatjes"), 1);
});

test("zoeken: losse letters blijven geen match", () => {
  // Het weglaten van spaties mag geen nieuwe overeenkomsten verzinnen die niet
  // uit dezelfde letters bestaan.
  assert.ok(scoreStoreProductForIngredient("Appelmoes", "AH Bananen") < 0.6);
});
