import test from "node:test";
import assert from "node:assert/strict";
import { parseBulkFixedGroceryInput } from "./fixedGroceryProductChoice";

test("parseBulkFixedGroceryInput splitst regels en komma's", () => {
  const lines = parseBulkFixedGroceryInput("2 pakken magere melk, drinkyoghurt framboos\nbananen; appels");

  assert.deepEqual(lines, [
    { raw: "2 pakken magere melk", searchTerm: "magere melk", multiplier: 2 },
    { raw: "drinkyoghurt framboos", searchTerm: "drinkyoghurt framboos", multiplier: 1 },
    { raw: "bananen", searchTerm: "bananen", multiplier: 1 },
    { raw: "appels", searchTerm: "appels", multiplier: 1 },
  ]);
});

test("parseBulkFixedGroceryInput behoudt aantal zonder verpakkingswoord", () => {
  const lines = parseBulkFixedGroceryInput("6 bananen, 2.5 kg aardappelen");

  assert.deepEqual(lines, [
    { raw: "6 bananen", searchTerm: "bananen", multiplier: 6 },
    { raw: "2.5 kg aardappelen", searchTerm: "aardappelen", multiplier: 2.5 },
  ]);
});
