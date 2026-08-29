import { test } from "node:test";
import assert from "node:assert/strict";
import { compareEquivalence, countsAsHardMatch } from "./equivalence";

const VERSE_MELK = {
  name: "AH Verse halfvolle melk",
  brand: "AH",
  packageSize: "1 l",
  qualityTier: "STANDAARD" as const,
  gtin: "08710400003601",
};

test("zelfde barcode is hetzelfde product", () => {
  const verdict = compareEquivalence(VERSE_MELK, { ...VERSE_MELK, name: "Anders geschreven naam" });
  assert.equal(verdict.level, "IDENTIEK");
  assert.equal(verdict.reason, "zelfde barcode");
});

test("zonder barcodes aan beide kanten telt merk plus verpakking", () => {
  const verdict = compareEquivalence(
    { ...VERSE_MELK, gtin: null },
    { ...VERSE_MELK, gtin: null, name: "Halfvolle melk vers" }
  );
  assert.equal(verdict.level, "IDENTIEK");
  assert.equal(verdict.reason, "zelfde merk en verpakking");
});

test("het voorbeeld uit de opdracht: houdbare melk is geen gelijkwaardige vervanger", () => {
  // Zelfde winkel, zelfde merk, zelfde klasse — en tóch een ander product.
  // Zonder deze regel zou 34% "besparing" gemeld worden die niemand wilde.
  const verdict = compareEquivalence(VERSE_MELK, {
    name: "AH Houdbare halfvolle melk",
    brand: "AH",
    packageSize: "1 l",
    qualityTier: "STANDAARD",
    gtin: null,
  });
  assert.equal(verdict.level, "ALTERNATIEF");
  assert.equal(verdict.reason, "houdbaar in plaats van vers");
});

test("zelfde klasse en zelfde soort is gelijkwaardig, ook bij een ander merk", () => {
  const verdict = compareEquivalence(
    { ...VERSE_MELK, gtin: null },
    { name: "Melkunie verse halfvolle melk", brand: "Melkunie", packageSize: "500 ml", qualityTier: "STANDAARD", gtin: null }
  );
  assert.equal(verdict.level, "GELIJKWAARDIG");
});

test("een voordeelmerk tegenover een gewone keuze is een alternatief", () => {
  const verdict = compareEquivalence(
    { name: "Kipfilet naturel", brand: "AH", packageSize: "300 g", qualityTier: "STANDAARD", gtin: null },
    { name: "1 de Beste kipfilet", brand: "1 de Beste", packageSize: "300 g", qualityTier: "BUDGET", gtin: null }
  );
  assert.equal(verdict.level, "ALTERNATIEF");
  assert.match(verdict.reason, /voordeelmerk/);
});

test("bio tegenover niet-bio is een alternatief, in beide richtingen", () => {
  const bio = { name: "Biologische melk", brand: "AH", packageSize: "1 l", qualityTier: "BIO" as const, gtin: null };
  const gewoon = { name: "Melk", brand: "AH", packageSize: "1 l", qualityTier: "STANDAARD" as const, gtin: null };
  // Merk en verpakking zijn hier gelijk, dus het onderscheid moet uit de
  // klasse komen — daarom bewust een ander merk aan één kant.
  assert.equal(compareEquivalence({ ...bio, brand: "Zuiver" }, gewoon).level, "ALTERNATIEF");
  assert.equal(compareEquivalence(gewoon, { ...bio, brand: "Zuiver" }).level, "ALTERNATIEF");
});

test("een onbekend merk staat gelijkwaardigheid niet in de weg", () => {
  // Bewuste bijsturing door de gebruiker: "als het qua product maar
  // vergelijkbaar is — verse melk = verse melk, merk maakt dan niet uit".
  // Eerder gold hier "niet vergelijkbaar", en omdat onze eigen producten
  // zelden een merkveld hebben viel er daardoor nergens iets te vergelijken.
  const verdict = compareEquivalence(
    { name: "Halfvolle melk", brand: null, packageSize: "1 l", qualityTier: null, gtin: null },
    { name: "Halfvolle melk", brand: "Dirk", packageSize: "500 ml", qualityTier: "STANDAARD", gtin: null }
  );
  assert.equal(verdict.level, "GELIJKWAARDIG");
  assert.match(verdict.reason, /ander merk/);
});

test("maar het soort product blijft wél tellen, ook als het merk onbekend is", () => {
  // De bescherming die er echt toe doet blijft staan: dit is precies het
  // voorbeeld waar de opdracht mee opent.
  const verdict = compareEquivalence(
    { name: "Verse halfvolle melk", brand: null, packageSize: "1 l", qualityTier: null, gtin: null },
    { name: "AH Houdbare halfvolle melk", brand: "AH", packageSize: "1 l", qualityTier: "STANDAARD", gtin: null }
  );
  assert.equal(verdict.level, "ALTERNATIEF");
  assert.equal(verdict.reason, "houdbaar in plaats van vers");
});

test("en een bekend verschil in klasse blijft een alternatief", () => {
  const verdict = compareEquivalence(
    { name: "Melk", brand: "Campina", packageSize: "1 l", qualityTier: "STANDAARD", gtin: null },
    { name: "AH Basic melk", brand: "AH Basic", packageSize: "1 l", qualityTier: "BUDGET", gtin: null }
  );
  assert.equal(verdict.level, "ALTERNATIEF");
  assert.match(verdict.reason, /voordeelmerk/);
});

test("alleen identiek en gelijkwaardig tellen in het harde bedrag", () => {
  assert.equal(countsAsHardMatch("IDENTIEK"), true);
  assert.equal(countsAsHardMatch("GELIJKWAARDIG"), true);
  assert.equal(countsAsHardMatch("ALTERNATIEF"), false);
  assert.equal(countsAsHardMatch("NIET_VERGELIJKBAAR"), false);
});
