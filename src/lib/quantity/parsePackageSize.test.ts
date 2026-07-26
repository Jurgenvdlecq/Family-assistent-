import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePackageQuantity } from "./parsePackageSize";

test("eenvoudige gram/ml/stuks-teksten", () => {
  assert.equal(parsePackageQuantity("500 gram", "GRAM"), 500);
  assert.equal(parsePackageQuantity("250 ml", "ML"), 250);
  assert.equal(parsePackageQuantity("4 stuks", "PIECE"), 4);
});

test("kilogram en liter worden omgerekend naar de basis-eenheid", () => {
  assert.equal(parsePackageQuantity("1 kg", "GRAM"), 1000);
  assert.equal(parsePackageQuantity("2 kg net", "GRAM"), 2000);
  assert.equal(parsePackageQuantity("1 liter", "ML"), 1000);
  assert.equal(parsePackageQuantity("1 liter pak", "ML"), 1000);
});

test("beschrijvende toevoegingen (net, verpakking, blik) worden genegeerd", () => {
  assert.equal(parsePackageQuantity("500 gram net", "GRAM"), 500);
  assert.equal(parsePackageQuantity("500 gram verpakking", "GRAM"), 500);
  assert.equal(parsePackageQuantity("400 gram blik", "GRAM"), 400);
});

test("samengestelde tekst (stuks + gewicht): het stuksaantal wint als de ingrediënt-eenheid stuks is", () => {
  assert.equal(parsePackageQuantity("1 stuk, 300 gram", "PIECE"), 1);
  assert.equal(parsePackageQuantity("4 stuks, 300 gram", "PIECE"), 4);
});

test("samengestelde tekst in omgekeerde volgorde: het gewicht wint als de ingrediënt-eenheid gram is", () => {
  assert.equal(parsePackageQuantity("per stuk, ca. 350 gram", "GRAM"), 350);
});

test("'per stuk' en 'per kilo' zonder getal zijn ondubbelzinnig genoeg om te vertrouwen", () => {
  assert.equal(parsePackageQuantity("per stuk", "PIECE"), 1);
  assert.equal(parsePackageQuantity("per kilo", "GRAM"), 1000);
});

test("ontbrekende of niet-herleidbare verpakking geeft null, geen gok", () => {
  assert.equal(parsePackageQuantity(null, "GRAM"), null);
  assert.equal(parsePackageQuantity(undefined, "GRAM"), null);
  assert.equal(parsePackageQuantity("3 bollen", "PIECE"), null); // onbekende eenheid "bollen"
  assert.equal(parsePackageQuantity("12 blokjes", "ML"), null); // onbekende eenheid "blokjes"
});

test("eenheid-mismatch tussen tekst en ingrediënt levert bewust null op (geen gok)", () => {
  // "1 kg net" beschrijft een gewicht, maar dit ingrediënt wordt in stuks
  // geteld (bv. uien) — de app moet dit als twijfelgeval behandelen, niet
  // aannemen dat het om 1 stuk gaat.
  assert.equal(parsePackageQuantity("1 kg net", "PIECE"), null);
  assert.equal(parsePackageQuantity("per stuk", "GRAM"), null);
});

test("decimalen met komma worden herkend", () => {
  assert.equal(parsePackageQuantity("1,5 kg", "GRAM"), 1500);
});
