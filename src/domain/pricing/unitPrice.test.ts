import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatUnitPrice,
  parsePackContent,
  parseUnitPriceDescription,
  unitPriceFor,
} from "./unitPrice";

test("parsePackContent: gewone verpakkingsgroottes", () => {
  assert.deepEqual(parsePackContent("1 l"), { amount: 1000, unit: "ML" });
  assert.deepEqual(parsePackContent("500 ml"), { amount: 500, unit: "ML" });
  assert.deepEqual(parsePackContent("300 g"), { amount: 300, unit: "GRAM" });
  assert.deepEqual(parsePackContent("1,5 kg"), { amount: 1500, unit: "GRAM" });
  assert.deepEqual(parsePackContent("6 stuks"), { amount: 6, unit: "PIECE" });
});

test("parsePackContent: een multipack is het product van beide getallen", () => {
  // "2 x 350 g" is 700 gram, niet 2 en ook niet 350 — precies het soort fout
  // dat een prijsvergelijking overtuigend verkeerd maakt.
  assert.deepEqual(parsePackContent("2 x 350 g"), { amount: 700, unit: "GRAM" });
  assert.deepEqual(parsePackContent("6 x 500 ml"), { amount: 3000, unit: "ML" });
});

test("parsePackContent: wat niet ondubbelzinnig te lezen is geeft null, geen gok", () => {
  // Liever "niet vergelijkbaar" dan een verkeerd gelezen inhoud: die laatste
  // levert een vergelijking op die er goed uitziet en fout is.
  assert.equal(parsePackContent("naar keuze"), null);
  assert.equal(parsePackContent(""), null);
  assert.equal(parsePackContent(null), null);
  assert.equal(parsePackContent("familieverpakking"), null);
});

/**
 * Eenheidsprijzen zijn delingen, dus vergelijken op de laatste bit heeft geen
 * betekenis. Een marge van 1e-9 ligt ver onder een cent per kilo.
 */
function assertUnitPrice(
  actual: ReturnType<typeof unitPriceFor>,
  expected: { amount: number; unit: string }
) {
  assert.ok(actual, "er hoort een eenheidsprijs uit te komen");
  assert.equal(actual!.unit, expected.unit);
  assert.ok(
    Math.abs(actual!.amount - expected.amount) < 1e-9,
    `verwacht ~${expected.amount}, kreeg ${actual!.amount}`
  );
}

test("unitPriceFor: prijs per basiseenheid", () => {
  assertUnitPrice(unitPriceFor(1.29, { amount: 1000, unit: "ML" }), { amount: 0.00129, unit: "ML" });
  assertUnitPrice(unitPriceFor(3, { amount: 6, unit: "PIECE" }), { amount: 0.5, unit: "PIECE" });
});

test("unitPriceFor: zonder bekende inhoud geen eenheidsprijs", () => {
  assert.equal(unitPriceFor(1.29, null), null);
  assert.equal(unitPriceFor(1.29, { amount: 0, unit: "ML" }), null);
});

test("het voorbeeld uit de opdracht: halve liters zijn duurder dan hele", () => {
  // AH 1 liter voor €1,29 tegenover Dirk 500 ml voor €0,95. Naast elkaar
  // lijkt Dirk goedkoper; per liter is hij duurder.
  const ah = unitPriceFor(1.29, parsePackContent("1 l"))!;
  const dirk = unitPriceFor(0.95, parsePackContent("500 ml"))!;
  assert.ok(ah.amount < dirk.amount, "per liter hoort AH hier goedkoper te zijn");
  assert.equal(formatUnitPrice(ah), "€ 1,29 per liter");
  assert.equal(formatUnitPrice(dirk), "€ 1,90 per liter");
});

test("parseUnitPriceDescription: leest de kant-en-klare AH-eenheidsprijs", () => {
  assertUnitPrice(parseUnitPriceDescription("prijs per liter €1.29"), { amount: 0.00129, unit: "ML" });
  assertUnitPrice(parseUnitPriceDescription("Prijs per kilo € 8,95"), { amount: 0.00895, unit: "GRAM" });
  assertUnitPrice(parseUnitPriceDescription("prijs per stuk €0.79"), { amount: 0.79, unit: "PIECE" });
  assertUnitPrice(parseUnitPriceDescription("prijs per 100 g €1.10"), { amount: 0.011, unit: "GRAM" });
});

test("parseUnitPriceDescription: onbekende vorm geeft null", () => {
  assert.equal(parseUnitPriceDescription("bij 2 stuks"), null);
  assert.equal(parseUnitPriceDescription(null), null);
});

test("formatUnitPrice: null blijft null — nooit '€ 0,00 per kilo' tonen", () => {
  assert.equal(formatUnitPrice(null), null);
});

test("een multipack wordt vermenigvuldigd, zodat €/liter over winkels heen klopt", () => {
  // De aanleiding: onze eigen kolom rekende met de inhoud van één fles uit
  // "6 x 1 liter" en toonde € 6,00 per liter naast een correcte € 1,00 per
  // liter van Albert Heijn. Beide kanten lezen nu met deze functie.
  assert.deepEqual(parsePackContent("6 x 1 liter"), { amount: 6000, unit: "ML" });
  assert.deepEqual(parsePackContent("4 x 125 gram"), { amount: 500, unit: "GRAM" });
  assert.equal(formatUnitPrice(unitPriceFor(6, parsePackContent("6 x 1 liter"))), "€ 1,00 per liter");
});
