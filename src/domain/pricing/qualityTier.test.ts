import { test } from "node:test";
import assert from "node:assert/strict";
import { comparablePreservation, derivePreservation, deriveQualityTier, sameQualityTier } from "./qualityTier";

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

test("vers/houdbaar: 'houdbare' telt, en 'diverse' is geen 'vers'", () => {
  // Twee fouten die met een test zijn aangetoond: zoeken op precies
  // "houdbaar" mist de vorm die op het pak staat, en zoeken op "vers" als
  // deelreeks slaat aan op "diverse".
  assert.equal(derivePreservation("AH Houdbare halfvolle melk"), "HOUDBAAR");
  assert.equal(derivePreservation("AH Verse halfvolle melk"), "VERS");
  assert.equal(derivePreservation("Diverse groenten"), null);
});

test("vers/houdbaar: onbekend tegenover onbekend is geen bezwaar", () => {
  // De meeste producten zeggen er niets over; dat mag geen reden zijn om
  // alles onvergelijkbaar te noemen.
  assert.equal(comparablePreservation(null, null), true);
  assert.equal(comparablePreservation("VERS", null), false);
  assert.equal(comparablePreservation("VERS", "VERS"), true);
  assert.equal(comparablePreservation("VERS", "HOUDBAAR"), false);
});

test("klasse: de winkelnaam vooraan in de productnaam telt als huismerk", () => {
  // Uit productiegebruik: onze eigen ingrediënten heten "Picnic Hagelslag" en
  // hebben géén merkveld. Zonder deze aflezing bleef élke regel "soort product
  // niet vast te stellen" en viel er niets te vergelijken.
  assert.equal(deriveQualityTier({ provider: "PICNIC", name: "Picnic Hagelslag" }), "STANDAARD");
  assert.equal(deriveQualityTier({ provider: "AH", name: "AH Halfvolle melk" }), "STANDAARD");
});

test("klasse: de winkelnaam middenin de naam telt níét als huismerk", () => {
  // Alleen vooraan, anders wordt elke toevallige woordcombinatie een merk.
  assert.equal(deriveQualityTier({ provider: "PICNIC", name: "Kaas voor de picnic" }), null);
});
