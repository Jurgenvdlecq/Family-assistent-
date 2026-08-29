import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSplitAdvice, describeSplitAdvice, SPLIT_ADVICE_THRESHOLD } from "./splitAdvice";
import { adviseStockUp, MAX_EXTRA_PACKAGES } from "./stockUpAdvice";
import type { BasketComparison, BasketLineResult, BasketLineStoreResult } from "./basketComparison";

function storeResult(overrides: Partial<BasketLineStoreResult> = {}): BasketLineStoreResult {
  return {
    provider: "DIRK",
    productId: "dirk-1",
    name: "Melkunie halfvolle melk",
    packageSize: "1 l",
    packageQuantity: 1000,
    packagesToBuy: 3,
    cost: 3,
    surplus: null,
    level: "GELIJKWAARDIG",
    levelReason: "zelfde soort product",
    promoLabel: null,
    promoExplanation: null,
    costWithoutPromo: 3,
    fakeDiscount: false,
    observedAt: new Date("2026-08-28T05:00:00Z"),
    stale: false,
    missingReason: null,
    ...overrides,
  };
}

function lineResult(
  lineId: string,
  referenceCost: number | null,
  stores: BasketLineStoreResult[]
): BasketLineResult {
  return {
    lineId,
    ingredientName: `Product ${lineId}`,
    neededQuantity: 3000,
    unit: "ML",
    referencePrice: 1.45,
    referenceName: "Campina halfvolle melk",
    referenceCost,
    referencePackages: 3,
    stores: new Map(stores.map((store) => [store.provider, store])),
  };
}

function comparison(lines: BasketLineResult[]): BasketComparison {
  return { lines, referenceTotal: 0, referenceLinesMissing: 0, totals: new Map() };
}

test("splitsen: onder de drempel zegt de app niets", () => {
  // Een advies dat elke week verschijnt met een besparing van € 0,40 leert de
  // gebruiker om het te negeren.
  const advice = buildSplitAdvice(comparison([lineResult("a", 3.4, [storeResult({ cost: 3 })])]));
  assert.deepEqual(advice, []);
});

test("splitsen: boven de drempel komt er een concreet advies met de producten erbij", () => {
  const lines = [
    lineResult("a", 10, [storeResult({ cost: 7 })]),
    lineResult("b", 8, [storeResult({ productId: "dirk-2", cost: 5 })]),
  ];
  const [advice] = buildSplitAdvice(comparison(lines));
  assert.equal(advice.provider, "DIRK");
  assert.equal(advice.totalSaving, 6);
  assert.equal(advice.items.length, 2);
  assert.ok(advice.totalSaving >= SPLIT_ADVICE_THRESHOLD);
  assert.match(describeSplitAdvice(advice, "Dirk"), /2 producten bij Dirk/);
  // Eerlijk erbij: het is wel een tweede winkel.
  assert.match(describeSplitAdvice(advice, "Dirk"), /tweede winkel/);
});

test("splitsen: een alternatief telt niet mee als besparing", () => {
  // Goedkoper door iets anders te kopen is geen besparing — dezelfde regel als
  // in de rest van de vergelijking.
  const advice = buildSplitAdvice(
    comparison([
      lineResult("a", 10, [storeResult({ cost: 3, level: "ALTERNATIEF" })]),
      lineResult("b", 10, [storeResult({ productId: "dirk-2", cost: 3, level: "NIET_VERGELIJKBAAR" })]),
    ])
  );
  assert.deepEqual(advice, []);
});

test("splitsen: zonder eigen prijs valt er niets te adviseren", () => {
  const advice = buildSplitAdvice(comparison([lineResult("a", null, [storeResult({ cost: 1 })])]));
  assert.deepEqual(advice, []);
});

test("inslaan: alleen bij een bekende normale prijs", () => {
  // Zonder geschiedenis weet je niet of dit een korting is; dan is "sla in"
  // gokken met het geld van de gebruiker.
  assert.equal(
    adviseStockUp({
      ingredientName: "Pindakaas",
      productName: "AH Pindakaas",
      packagesThisWeek: 1,
      pricePerPackage: 1.5,
      typicalPricePerPackage: null,
      inStock: 0,
      packageQuantity: 350,
    }),
    null
  );
});

test("inslaan: niet bij verse producten", () => {
  // Verse producten inslaan is eten weggooien met een omweg.
  assert.equal(
    adviseStockUp({
      ingredientName: "Melk",
      productName: "AH Verse halfvolle melk",
      packagesThisWeek: 3,
      pricePerPackage: 0.99,
      typicalPricePerPackage: 1.49,
      inStock: 0,
      packageQuantity: 1000,
    }),
    null
  );
});

test("inslaan: niet als de kast al vol ligt", () => {
  // Precies de faalwijze die dit moet voorkomen: nog eens drie potten erbij
  // terwijl er al genoeg staat.
  assert.equal(
    adviseStockUp({
      ingredientName: "Pindakaas",
      productName: "AH Pindakaas",
      packagesThisWeek: 1,
      pricePerPackage: 1.49,
      typicalPricePerPackage: 2.49,
      inStock: 700,
      packageQuantity: 350,
    }),
    null
  );
});

test("inslaan: wel bij een houdbaar product met een echte korting, en nooit meer dan het maximum", () => {
  const advice = adviseStockUp({
    ingredientName: "Pindakaas",
    productName: "AH Pindakaas",
    packagesThisWeek: 8,
    pricePerPackage: 1.49,
    typicalPricePerPackage: 2.49,
    inStock: 0,
    packageQuantity: 350,
  });
  assert.ok(advice);
  assert.equal(advice!.extraPackages, MAX_EXTRA_PACKAGES, "nooit een kast vol adviseren");
  assert.equal(advice!.saving, 3);
  assert.match(advice!.reason, /blijft lang goed/);
});

test("inslaan: een paar cent voordeel is geen advies", () => {
  assert.equal(
    adviseStockUp({
      ingredientName: "Pindakaas",
      productName: "AH Pindakaas",
      packagesThisWeek: 1,
      pricePerPackage: 2.39,
      typicalPricePerPackage: 2.49,
      inStock: 0,
      packageQuantity: 350,
    }),
    null
  );
});
