import { test } from "node:test";
import assert from "node:assert/strict";
import { toBaseUnit, combineQuantities } from "./units";

test("gram en stuks blijven ongewijzigd", () => {
  assert.deepEqual(toBaseUnit({ amount: 500, unit: "GRAM" }), { amount: 500, unit: "GRAM" });
  assert.deepEqual(toBaseUnit({ amount: 4, unit: "PIECE" }), { amount: 4, unit: "PIECE" });
});

test("kilogram en liter worden omgerekend naar gram/ml (verschillende eenheden)", () => {
  assert.deepEqual(toBaseUnit({ amount: 1.5, unit: "KILOGRAM" }), { amount: 1500, unit: "GRAM" });
  assert.deepEqual(toBaseUnit({ amount: 2, unit: "LITER" }), { amount: 2000, unit: "ML" });
});

test("ongeldige hoeveelheid (NaN) geeft een fout", () => {
  assert.throws(() => toBaseUnit({ amount: NaN, unit: "GRAM" }));
});

test("combineQuantities telt dezelfde eenheid op (meerdere recepten combineren)", () => {
  const total = combineQuantities([
    { amount: 200, unit: "GRAM" },
    { amount: 300, unit: "GRAM" },
    { amount: 400, unit: "GRAM" },
  ]);
  assert.deepEqual(total, { amount: 900, unit: "GRAM" });
});

test("combineQuantities weigert verschillende eenheden te mixen (ongeldige data)", () => {
  assert.throws(() =>
    combineQuantities([
      { amount: 200, unit: "GRAM" },
      { amount: 1, unit: "ML" },
    ])
  );
});

test("combineQuantities weigert een lege lijst en negatieve hoeveelheden", () => {
  assert.throws(() => combineQuantities([]));
  assert.throws(() => combineQuantities([{ amount: -5, unit: "GRAM" }]));
});

test("combineQuantities werkt met decimalen", () => {
  const total = combineQuantities([
    { amount: 0.5, unit: "ML" },
    { amount: 0.25, unit: "ML" },
  ]);
  assert.equal(total.amount, 0.75);
});
