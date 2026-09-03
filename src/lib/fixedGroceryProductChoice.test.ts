import test from "node:test";
import assert from "node:assert/strict";
import {
  inferFixedProductOrderQuantity,
  parseBulkFixedGroceryInput,
  removeBulkFixedGroceryLine,
} from "./fixedGroceryProductChoice";

test("parseBulkFixedGroceryInput splitst regels en komma's", () => {
  const lines = parseBulkFixedGroceryInput("2 pakken magere melk, drinkyoghurt framboos\nbananen; appels");

  assert.deepEqual(lines, [
    { raw: "2 pakken magere melk", searchTerm: "magere melk", multiplier: 2 },
    { raw: "drinkyoghurt framboos", searchTerm: "drinkyoghurt framboos", multiplier: 1 },
    { raw: "bananen", searchTerm: "bananen", multiplier: 1 },
    { raw: "appels", searchTerm: "appels", multiplier: 1 },
  ]);
});

test("parseBulkFixedGroceryInput behoudt aantal zonder verpakkingswoord", () => {
  const lines = parseBulkFixedGroceryInput("6 bananen, 2.5 kg aardappelen");

  assert.deepEqual(lines, [
    { raw: "6 bananen", searchTerm: "bananen", multiplier: 6 },
    { raw: "2.5 kg aardappelen", searchTerm: "aardappelen", multiplier: 2.5 },
  ]);
});

test("inferFixedProductOrderQuantity gebruikt verpakkingen als bestelaantal", () => {
  assert.deepEqual(inferFixedProductOrderQuantity(), { quantity: 1, unit: "PIECE" });
  assert.deepEqual(inferFixedProductOrderQuantity(2), { quantity: 2, unit: "PIECE" });
});

test("removeBulkFixedGroceryLine verwijdert alleen de gekozen regel uit de bulkpreview", () => {
  const remaining = removeBulkFixedGroceryLine(
    "2 pakken magere melk, drinkyoghurt framboos\nbananen",
    "drinkyoghurt framboos"
  );

  assert.equal(remaining, "2 pakken magere melk\nbananen");
});

/**
 * Gebruikersverzoek: in de winkel je lijstje kunnen inspreken in plaats van
 * intikken. De herkenning doet de browser; wat de app moet kunnen is de zin
 * die daaruit komt uit elkaar halen.
 *
 * Ingesproken tekst ziet er anders uit dan getikte tekst: geen regeleindes,
 * "en" tussen de laatste twee dingen, telwoorden voluit, en een aanloopje
 * ("doe maar", "we hebben nog ... nodig") dat niets over het product zegt.
 */
test("gesproken lijstje: 'en' splitst net zo goed als een komma", () => {
  const regels = parseBulkFixedGroceryInput("melk, brood, drie pakken hagelslag en een pot pindakaas");
  assert.deepEqual(
    regels.map((r) => `${r.multiplier}x ${r.searchTerm}`),
    ["1x melk", "1x brood", "3x hagelslag", "1x pindakaas"]
  );
});

test("gesproken lijstje: telwoorden voluit tellen als aantal", () => {
  const regels = parseBulkFixedGroceryInput("twee zakken sperziebonen");
  assert.equal(regels[0].multiplier, 2);
  assert.equal(regels[0].searchTerm, "sperziebonen");
});

test("gesproken lijstje: het aanloopje hoort niet in de zoekterm", () => {
  assert.deepEqual(
    parseBulkFixedGroceryInput("doe maar twee zakken sperziebonen en appelmoes").map(
      (r) => `${r.multiplier}x ${r.searchTerm}`
    ),
    ["2x sperziebonen", "1x appelmoes"]
  );
  assert.deepEqual(
    parseBulkFixedGroceryInput("we hebben nog bananen nodig en vier bakjes yoghurt").map(
      (r) => `${r.multiplier}x ${r.searchTerm}`
    ),
    ["1x bananen", "4x yoghurt"]
  );
});

test("gesproken lijstje: een regel die alleen uit aanloopwoorden bestaat blijft staan", () => {
  // Liever een matige zoekopdracht dan een lege: als er na het strippen niets
  // overblijft, is er kennelijk geen product genoemd en houden we wat er stond.
  const regels = parseBulkFixedGroceryInput("doe maar");
  assert.equal(regels.length, 1);
  assert.equal(regels[0].searchTerm, "doe maar");
});

test("getikte lijstjes blijven werken zoals ze werkten", () => {
  // De oude vorm mag niet stilzwijgend veranderen: cijfers, regeleindes en
  // verpakkingswoorden werkten al.
  assert.deepEqual(
    parseBulkFixedGroceryInput("2 pakken magere melk\ndrinkyoghurt framboos\nbananen").map(
      (r) => `${r.multiplier}x ${r.searchTerm}`
    ),
    ["2x magere melk", "1x drinkyoghurt framboos", "1x bananen"]
  );
});
