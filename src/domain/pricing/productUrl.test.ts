import { test } from "node:test";
import assert from "node:assert/strict";
import { displayableProductUrl } from "./productUrl";

test("een opgeslagen link die geen http-adres is, komt niet op het scherm", () => {
  // Laatste horde vóór een `href`: een rij in `products` kan ook uit een
  // oudere versie of een handmatige ingreep komen, en dan is de provider die
  // er normaal op let al gepasseerd.
  assert.equal(
    displayableProductUrl("https://www.ah.nl/producten/product/wi1"),
    "https://www.ah.nl/producten/product/wi1"
  );
  assert.equal(displayableProductUrl("javascript:alert(1)"), null);
  assert.equal(displayableProductUrl("data:text/html,<script>"), null);
  assert.equal(displayableProductUrl("zomaar wat tekst"), null);
  assert.equal(displayableProductUrl(null), null);
});
