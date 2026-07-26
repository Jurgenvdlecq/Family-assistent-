import { test } from "node:test";
import assert from "node:assert/strict";
import { subtractInventory, scaleQuantityForPersons } from "./inventory";

test("voorraad aftrekken: 900 gram nodig, 100 gram op voorraad -> 800 gram netto", () => {
  const net = subtractInventory({ amount: 900, unit: "GRAM" }, { amount: 100, unit: "GRAM" });
  assert.deepEqual(net, { amount: 800, unit: "GRAM" });
});

test("voorraad aftrekken gaat nooit onder nul (meer op voorraad dan nodig)", () => {
  const net = subtractInventory({ amount: 100, unit: "GRAM" }, { amount: 500, unit: "GRAM" });
  assert.equal(net.amount, 0);
});

test("voorraad aftrekken weigert verschillende eenheden (ongeldige data)", () => {
  assert.throws(() => subtractInventory({ amount: 500, unit: "GRAM" }, { amount: 1, unit: "ML" }));
});

test("opschalen naar aantal personen", () => {
  const scaled = scaleQuantityForPersons({ amount: 400, unit: "GRAM" }, 2, 4);
  assert.deepEqual(scaled, { amount: 800, unit: "GRAM" });
});

test("opschalen met decimalen (bv. van 4 naar 3 personen)", () => {
  const scaled = scaleQuantityForPersons({ amount: 400, unit: "GRAM" }, 4, 3);
  assert.equal(scaled.amount, 300);
});

test("opschalen weigert ongeldige personenaantallen", () => {
  assert.throws(() => scaleQuantityForPersons({ amount: 400, unit: "GRAM" }, 0, 4));
  assert.throws(() => scaleQuantityForPersons({ amount: 400, unit: "GRAM" }, 4, -1));
});
