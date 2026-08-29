import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeDiscount, summarizePriceHistory, type PriceSample } from "./priceHistory";

const NOW = new Date("2026-08-29T05:00:00Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function sample(price: number, days: number, wasPrice: number | null = null): PriceSample {
  return { price, wasPrice, observedAt: daysAgo(days) };
}

test("geschiedenis: de gewone prijs is de mediaan, niet het gemiddelde", () => {
  // Eén actieweek zou een gemiddelde meetrekken; de mediaan zegt eerlijker
  // wat je normaal betaalt.
  const summary = summarizePriceHistory([
    sample(1.29, 1),
    sample(1.29, 8),
    sample(0.79, 15),
    sample(1.29, 22),
    sample(1.35, 29),
  ]);
  assert.equal(summary.typicalPrice, 1.29);
  assert.equal(summary.lowestPrice, 0.79);
  assert.equal(summary.highestPrice, 1.35);
  assert.equal(summary.samples, 5);
});

test("geschiedenis: te weinig waarnemingen levert geen 'normale prijs' op", () => {
  // Twee metingen zijn geen patroon. Dan liever niets zeggen.
  const summary = summarizePriceHistory([sample(1.29, 1), sample(1.35, 8)]);
  assert.equal(summary.typicalPrice, null);
  assert.equal(summary.lowestPrice, 1.29, "de uitersten weten we wél");
});

test("nepkorting: een van-prijs die hier nooit gerekend is, is geen korting", () => {
  // Het patroon: een week de prijs omhoog, daarna de gewone prijs een "actie"
  // noemen. Met een reeks waarnemingen is dat zichtbaar.
  const verdict = judgeDiscount(
    { price: 1.29, wasPrice: 1.99, observedAt: daysAgo(0) },
    [sample(1.29, 7), sample(1.29, 14), sample(1.29, 21), sample(1.29, 28)],
    NOW
  );
  assert.equal(verdict.kind, "NEPKORTING");
  assert.match(verdict.reason, /normale prijs/);
});

test("nepkorting: een van-prijs die er echt was, is een echte korting", () => {
  const verdict = judgeDiscount(
    { price: 1.29, wasPrice: 1.99, observedAt: daysAgo(0) },
    [sample(1.99, 7), sample(1.99, 14), sample(1.99, 21), sample(1.99, 28)],
    NOW
  );
  assert.equal(verdict.kind, "ECHTE_KORTING");
  assert.equal(verdict.kind === "ECHTE_KORTING" ? verdict.savedPerPackage : null, 0.7);
});

test("nepkorting: zonder geschiedenis zegt de app niets", () => {
  // Niet de winkel op zijn woord geloven, maar 'm ook niet ten onrechte van
  // bedrog betichten.
  const verdict = judgeDiscount(
    { price: 1.29, wasPrice: 1.99, observedAt: daysAgo(0) },
    [sample(1.99, 7)],
    NOW
  );
  assert.equal(verdict.kind, "ONBEKEND");
  assert.match(verdict.reason, /te weinig/);
});

test("nepkorting: waarnemingen van vóór het venster tellen niet mee", () => {
  // Een van-prijs die twee jaar geleden gold, zegt niets over vandaag.
  const verdict = judgeDiscount(
    { price: 1.29, wasPrice: 1.99, observedAt: daysAgo(0) },
    [sample(1.99, 400), sample(1.29, 7), sample(1.29, 14), sample(1.29, 21), sample(1.29, 28)],
    NOW
  );
  assert.equal(verdict.kind, "NEPKORTING");
});

test("nepkorting: een prijs die echt onder het gebruikelijke ligt telt, ook zonder kloppende van-prijs", () => {
  const verdict = judgeDiscount(
    { price: 0.99, wasPrice: 2.49, observedAt: daysAgo(0) },
    [sample(1.49, 7), sample(1.49, 14), sample(1.49, 21), sample(1.49, 28)],
    NOW
  );
  assert.equal(verdict.kind, "ECHTE_KORTING");
  assert.equal(verdict.kind === "ECHTE_KORTING" ? verdict.savedPerPackage : null, 0.5);
});

test("nepkorting: zonder van-prijs is er niets te beoordelen", () => {
  const verdict = judgeDiscount({ price: 1.29, wasPrice: null, observedAt: daysAgo(0) }, [], NOW);
  assert.equal(verdict.kind, "ONBEKEND");
  assert.equal(verdict.reason, "geen actie");
});
