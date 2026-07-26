import { test } from "node:test";
import assert from "node:assert/strict";
import { describeLinePackaging } from "./shoppingList";

test("describeLinePackaging: verpakking bekend -> OK met aantal/totaal/overschot", () => {
  const result = describeLinePackaging({ quantity: 900, unit: "GRAM" }, { packageQuantity: 500 });
  assert.equal(result.status, "OK");
  assert.equal(result.packagesToBuy, 2);
  assert.equal(result.totalPurchased!.amount, 1000);
  assert.equal(result.expectedSurplus!.amount, 100);
});

test("describeLinePackaging: geen product -> PACKAGE_UNKNOWN", () => {
  const result = describeLinePackaging({ quantity: 400, unit: "GRAM" }, null);
  assert.equal(result.status, "PACKAGE_UNKNOWN");
});

test("describeLinePackaging: product zonder bekende packageQuantity -> PACKAGE_UNKNOWN", () => {
  const result = describeLinePackaging({ quantity: 400, unit: "GRAM" }, { packageQuantity: null });
  assert.equal(result.status, "PACKAGE_UNKNOWN");
});

test("describeLinePackaging: exact één verpakking -> geen overschot", () => {
  const result = describeLinePackaging({ quantity: 500, unit: "GRAM" }, { packageQuantity: 500 });
  assert.equal(result.status, "OK");
  assert.equal(result.packagesToBuy, 1);
  assert.equal(result.expectedSurplus!.amount, 0);
});

test("describeLinePackaging: stuksproducten werken hetzelfde", () => {
  const result = describeLinePackaging({ quantity: 7, unit: "PIECE" }, { packageQuantity: 6 });
  assert.equal(result.status, "OK");
  assert.equal(result.packagesToBuy, 2);
});
