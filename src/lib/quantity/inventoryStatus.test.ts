import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveInStockQuantity } from "./inventoryStatus";

test("SUFFICIENT zonder expliciete hoeveelheid dekt de volledige behoefte", () => {
  const result = resolveInStockQuantity("SUFFICIENT", null, { amount: 500, unit: "GRAM" });
  assert.deepEqual(result, { amount: 500, unit: "GRAM" });
});

test("LOW/OUT_OF_STOCK/UNKNOWN nemen niets aan: volledige behoefte blijft staan", () => {
  for (const status of ["LOW", "OUT_OF_STOCK", "UNKNOWN"] as const) {
    const result = resolveInStockQuantity(status, null, { amount: 500, unit: "GRAM" });
    assert.deepEqual(result, { amount: 0, unit: "GRAM" });
  }
});

test("een expliciete hoeveelheid wint altijd, ongeacht status", () => {
  const result = resolveInStockQuantity("LOW", { amount: 200, unit: "GRAM" }, { amount: 500, unit: "GRAM" });
  assert.deepEqual(result, { amount: 200, unit: "GRAM" });
});

test("expliciete hoeveelheid in een andere eenheid dan de behoefte geeft een fout", () => {
  assert.throws(() =>
    resolveInStockQuantity("SUFFICIENT", { amount: 1, unit: "ML" }, { amount: 500, unit: "GRAM" })
  );
});
