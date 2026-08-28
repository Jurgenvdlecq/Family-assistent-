import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCartItemCount } from "./cartState";

test("parseCartItemCount: gebruikt de expliciete telling van Picnic", () => {
  assert.equal(parseCartItemCount({ total_count: 7, items: [{}, {}] }), 7);
});

test("parseCartItemCount: een leeg mandje is 0, niet 'onbekend'", () => {
  assert.equal(parseCartItemCount({ total_count: 0, items: [] }), 0);
});

test("parseCartItemCount: valt terug op het aantal regels als de telling ontbreekt", () => {
  assert.equal(parseCartItemCount({ items: [{}, {}, {}] }), 3);
  assert.equal(parseCartItemCount({ items: [] }), 0);
});

test("parseCartItemCount: onherkenbare vorm geeft null, nooit een gok", () => {
  // Dit getal bepaalt of de app vraagt "heb je besteld?" — die vraag mag
  // nooit voortkomen uit een verkeerd gelezen respons.
  assert.equal(parseCartItemCount(null), null);
  assert.equal(parseCartItemCount(undefined), null);
  assert.equal(parseCartItemCount("leeg"), null);
  assert.equal(parseCartItemCount({}), null);
  assert.equal(parseCartItemCount({ items: "geen array" }), null);
});

test("parseCartItemCount: een onzinnige telling wordt niet vertrouwd", () => {
  assert.equal(parseCartItemCount({ total_count: -1 }), null);
  assert.equal(parseCartItemCount({ total_count: Number.NaN }), null);
  assert.equal(parseCartItemCount({ total_count: "3" }), null);
});

test("parseCartItemCount: een onzinnige telling valt wél terug op de regels", () => {
  assert.equal(parseCartItemCount({ total_count: "3", items: [{}, {}] }), 2);
});
