import { test } from "node:test";
import assert from "node:assert/strict";
import { knownNameIndex, prepareSpokenText, splitSpokenRun } from "./spokenList";
import { parseBulkFixedGroceryInput } from "./fixedGroceryProductChoice";

/** Zoals de app het uiteindelijk gebruikt: knippen én daarna opschonen. */
function zoektermen(text: string, namen: string[] = []): string[] {
  return parseBulkFixedGroceryInput(prepareSpokenText(text, knownNameIndex(namen))).map(
    (line) => line.searchTerm
  );
}

test("een ingesproken zin zonder komma's wordt alsnog een lijstje", () => {
  assert.deepEqual(zoektermen("melk brood hagelslag pindakaas"), [
    "melk",
    "brood",
    "hagelslag",
    "pindakaas",
  ]);
});

test("bijvoeglijke woorden blijven bij hun product", () => {
  assert.deepEqual(zoektermen("magere melk volkoren brood bananen"), [
    "magere melk",
    "volkoren brood",
    "bananen",
  ]);
});

test("aantallen en verpakkingen horen bij het product dat erna komt", () => {
  const regels = parseBulkFixedGroceryInput(prepareSpokenText("twee pakken melk drie bananen appelmoes"));
  assert.deepEqual(
    regels.map((line) => [line.searchTerm, line.multiplier]),
    [
      ["melk", 2],
      ["bananen", 3],
      ["appelmoes", 1],
    ]
  );
});

test("namen die de app al kent worden niet uit elkaar getrokken", () => {
  assert.deepEqual(zoektermen("snoeptomaatjes komkommer", ["Snoeptomaatjes"]), [
    "snoeptomaatjes",
    "komkommer",
  ]);
  // Twee woorden die los allebei bestaan, maar samen één bekend product zijn.
  assert.deepEqual(zoektermen("drinkyoghurt framboos bananen", ["Drinkyoghurt Framboos"]), [
    "drinkyoghurt framboos",
    "bananen",
  ]);
});

test("inleidende en afsluitende woorden vallen weg, niet het product", () => {
  assert.deepEqual(zoektermen("doe maar twee zakken sperziebonen en appelmoes"), [
    "sperziebonen",
    "appelmoes",
  ]);
  assert.deepEqual(zoektermen("we hebben nog bananen nodig"), ["bananen"]);
});

test("komma's van de microfoon blijven staan, maar wat ertussen zit wordt wel geknipt", () => {
  // Zo levert de dicteerknop het aan: elke keer dat je stilvalt komt er een
  // komma bij, en juist bínnen zo'n stuk zit de zin die geknipt moet worden.
  assert.deepEqual(zoektermen("melk brood, hagelslag pindakaas"), [
    "melk",
    "brood",
    "hagelslag",
    "pindakaas",
  ]);
});

test("een enkel product blijft een enkel product", () => {
  assert.deepEqual(zoektermen("bananen"), ["bananen"]);
  assert.deepEqual(zoektermen("2 pakken magere melk"), ["magere melk"]);
});

test("een reeks die op vulwoorden eindigt levert geen half product op", () => {
  // "doe maar" is geen boodschap; er hoort geen lege of onzinnige zoekterm uit
  // te komen die daarna bij Picnic wordt opgezocht.
  assert.deepEqual(splitSpokenRun("doe maar twee"), ["doe maar twee"]);
});

test("lege invoer verandert niets", () => {
  assert.deepEqual(splitSpokenRun(""), []);
  assert.equal(prepareSpokenText(""), "");
});
