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
  assert.equal(parsePackageQuantity("3 bollen", "PIECE"), null); // een bol knoflook is geen teentje
  assert.equal(parsePackageQuantity("12 blokjes", "ML"), null); // onbekende eenheid "blokjes"
});

test("telwoorden die de inhoud van de verpakking noemen tellen mee", () => {
  // Gebruikersmelding-achtergrond: "9 rollen" toiletpapier had helemaal geen
  // verpakkingsinhoud, dus ook geen prijs per rol en geen pakkenberekening.
  assert.equal(parsePackageQuantity("9 rollen", "PIECE"), 9);
  assert.equal(parsePackageQuantity("1 rol", "PIECE"), 1);
  assert.equal(parsePackageQuantity("20 sneetjes", "PIECE"), 20);
  assert.equal(parsePackageQuantity("10 zakjes", "PIECE"), 10);
  assert.equal(parsePackageQuantity("36 wasbeurten", "PIECE"), 36);
  assert.equal(parsePackageQuantity("80 doekjes", "PIECE"), 80);
  assert.equal(parsePackageQuantity("6 flessen", "PIECE"), 6);
});

test("een verpakkingswoord in enkelvoud telt niet: dat noemt de verpakking, niet de inhoud", () => {
  // "1 pak" brood zegt niets over het aantal sneetjes waarin een recept
  // rekent. Meervoud is wél inhoud: dan is het een multipack.
  assert.equal(parsePackageQuantity("1 pak", "PIECE"), null);
  assert.equal(parsePackageQuantity("1 zak", "PIECE"), null);
  assert.equal(parsePackageQuantity("1 blik", "PIECE"), null);
  assert.equal(parsePackageQuantity("4 pakken", "PIECE"), 4);
});

test("een telwoord in stuks telt niet mee voor een ingrediënt in gram of ml", () => {
  assert.equal(parsePackageQuantity("9 rollen", "GRAM"), null);
  assert.equal(parsePackageQuantity("20 sneetjes", "ML"), null);
  // En andersom blijft het gewicht winnen als dat erbij staat.
  assert.equal(parsePackageQuantity("20 sneetjes, 800 gram", "GRAM"), 800);
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
