import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveQualityTier, sameQualityTier } from "./qualityTier";

test("klasse: biologisch wint van huismerk", () => {
  // "AH Biologische halfvolle melk" is allebei; voor de vergelijking is bio
  // het onderscheid dat telt.
  assert.equal(
    deriveQualityTier({ provider: "AH", name: "Biologische halfvolle melk", brand: "AH" }),
    "BIO"
  );
});

test("klasse: keurmerken tellen mee, niet alleen de naam", () => {
  assert.equal(
    deriveQualityTier({ provider: "AH", name: "Halfvolle melk", brand: "AH", labels: ["ORGANIC"] }),
    "BIO"
  );
});

test("klasse: voordeellijnen worden als BUDGET herkend", () => {
  assert.equal(deriveQualityTier({ provider: "AH", name: "AH Basic halfvolle melk", brand: "AH" }), "BUDGET");
  assert.equal(deriveQualityTier({ provider: "DIRK", name: "1 de Beste kipfilet", brand: "1 de Beste" }), "BUDGET");
});

test("klasse: premiumlijnen worden als PREMIUM herkend", () => {
  assert.equal(deriveQualityTier({ provider: "AH", name: "AH Excellent brie", brand: "AH Excellent" }), "PREMIUM");
});

test("klasse: het huismerk is de standaardklasse, niet de goedkoopste", () => {
  assert.equal(deriveQualityTier({ provider: "AH", name: "Halfvolle melk", brand: "AH" }), "STANDAARD");
});

test("klasse: zonder merk is de klasse onbekend, en dat blijft onbekend", () => {
  // Dit is de belangrijkste regel van deze module: een klasse verzinnen om te
  // kúnnen vergelijken is precies de fout die het model moet voorkomen.
  assert.equal(deriveQualityTier({ provider: "DIRK", name: "Halfvolle melk" }), null);
});

test("sameQualityTier: onbekend is nooit gelijk aan onbekend", () => {
  assert.equal(sameQualityTier(null, null), false, "twee keer niets weten is geen overeenkomst");
  assert.equal(sameQualityTier("BIO", null), false);
  assert.equal(sameQualityTier("BIO", "BIO"), true);
  assert.equal(sameQualityTier("BIO", "STANDAARD"), false);
});
