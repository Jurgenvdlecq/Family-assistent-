import { test } from "node:test";
import assert from "node:assert/strict";
import { matchProduct } from "./matchProduct";
import type { MatchCandidate } from "./types";

const NOW = new Date("2026-07-26T12:00:00Z");
const RECENT = new Date("2026-07-20T12:00:00Z"); // 6 dagen geleden
const STALE = new Date("2026-05-01T12:00:00Z"); // > 30 dagen geleden

function candidate(overrides: Partial<MatchCandidate> & { id: string }): MatchCandidate {
  return { packageQuantity: null, lastSeenAvailable: RECENT, price: null, ...overrides };
}

test("voorbeeld uit het ontwerpdocument: vertrouwd, juiste verpakking, beschikbaar, niet afgewezen", () => {
  const trusted = candidate({ id: "p1", packageQuantity: 500 });
  const result = matchProduct({
    candidates: [trusted],
    trusted: { productId: "p1", timesChosen: 4 },
    rejectedProductIds: new Set(["p2"]), // laat zien dat er wél een afwijslijst is
    now: NOW,
  });
  assert.equal(result.status, "MATCHED_TRUSTED");
  assert.equal(result.productId, "p1");
  assert.deepEqual(result.reasons, [
    "Eerder 4 keer gekozen.",
    "Heeft de juiste verpakking.",
    "Is momenteel beschikbaar.",
    "Staat niet op de afwijslijst.",
  ]);
});

test("geen kandidaten -> NOT_FOUND", () => {
  const result = matchProduct({ candidates: [], trusted: null, rejectedProductIds: new Set(), now: NOW });
  assert.equal(result.status, "NOT_FOUND");
  assert.equal(result.productId, null);
});

test("alle kandidaten afgewezen -> NOT_FOUND (niet UNAVAILABLE)", () => {
  const result = matchProduct({
    candidates: [candidate({ id: "p1" })],
    trusted: null,
    rejectedProductIds: new Set(["p1"]),
    now: NOW,
  });
  assert.equal(result.status, "NOT_FOUND");
});

test("precies één beschikbare kandidaat zonder voorkeur -> MATCHED_TRUSTED", () => {
  const result = matchProduct({
    candidates: [candidate({ id: "p1", packageQuantity: 250 })],
    trusted: null,
    rejectedProductIds: new Set(),
    now: NOW,
  });
  assert.equal(result.status, "MATCHED_TRUSTED");
  assert.equal(result.productId, "p1");
  assert.ok(result.reasons.some((r) => r.includes("enige bekende product")));
});

test("meerdere beschikbare kandidaten zonder voorkeur -> MATCHED_REVIEW_REQUIRED, deterministisch", () => {
  const input = {
    candidates: [
      candidate({ id: "p2", packageQuantity: null }),
      candidate({ id: "p1", packageQuantity: 500 }),
    ],
    trusted: null,
    rejectedProductIds: new Set<string>(),
    now: NOW,
  };
  const result = matchProduct(input);
  assert.equal(result.status, "MATCHED_REVIEW_REQUIRED");
  // p1 heeft een bekende verpakking en scoort dus hoger dan p2 — geen
  // willekeurige array-volgorde.
  assert.equal(result.productId, "p1");

  // Nogmaals aanroepen (zelfde input in andere volgorde) geeft hetzelfde resultaat.
  const resultAgain = matchProduct({ ...input, candidates: [...input.candidates].reverse() });
  assert.equal(resultAgain.productId, "p1");
});

test("volledig gelijke kandidaten worden deterministisch getiebreakt op id", () => {
  const result = matchProduct({
    candidates: [candidate({ id: "z-product" }), candidate({ id: "a-product" })],
    trusted: null,
    rejectedProductIds: new Set(),
    now: NOW,
  });
  assert.equal(result.productId, "a-product");
});

test("huishouden-voorkeur voordelig rangschikt goedkoper product hoger bij twijfel", () => {
  const result = matchProduct({
    candidates: [
      candidate({ id: "duurder", packageQuantity: 500, price: 6.99 }),
      candidate({ id: "goedkoper", packageQuantity: 500, price: 1.99 }),
    ],
    trusted: null,
    rejectedProductIds: new Set(),
    productChoicePreference: "LOW_PRICE",
    now: NOW,
  });
  assert.equal(result.status, "MATCHED_REVIEW_REQUIRED");
  assert.equal(result.productId, "goedkoper");
  // De reden noemt specifiek dat dit de goedkoopste van de opties is, niet
  // alleen een herhaling van de huishoudinstelling (Fase 12: geen
  // herhaalde algemene redenen).
  assert.ok(result.reasons.some((reason) => reason.includes("Goedkoopste van 2 beschikbare opties")));
});

test("gebalanceerde voorkeur legt specifiek uit dat dit de beste van meerdere opties is, geen algemene herhaling", () => {
  const result = matchProduct({
    candidates: [candidate({ id: "p2", packageQuantity: null }), candidate({ id: "p1", packageQuantity: 500 })],
    trusted: null,
    rejectedProductIds: new Set(),
    productChoicePreference: "BALANCED",
    now: NOW,
  });
  assert.equal(result.status, "MATCHED_REVIEW_REQUIRED");
  assert.ok(result.reasons.some((reason) => reason.includes("Beste van 2 beschikbare opties")));
  assert.ok(
    result.reasons.every((reason) => !reason.includes("gebalanceerde productkeuze")),
    "geen vaste, niets-zeggende herhaling van de huishoudinstelling"
  );
});

test("huishouden-voorkeur bekende verpakking geeft voorkeur aan berekenbare verpakking", () => {
  const result = matchProduct({
    candidates: [
      candidate({ id: "zonder-verpakking", packageQuantity: null, price: 1 }),
      candidate({ id: "met-verpakking", packageQuantity: 500, price: 3 }),
    ],
    trusted: null,
    rejectedProductIds: new Set(),
    productChoicePreference: "KNOWN_PACKAGE",
    now: NOW,
  });
  assert.equal(result.status, "MATCHED_REVIEW_REQUIRED");
  assert.equal(result.productId, "met-verpakking");
  assert.ok(result.reasons.some((reason) => reason.includes("verpakkingsgrootte")));
});

test("vertrouwde keuze die is afgewezen: valt terug op de resterende kandidaten", () => {
  // Drie kandidaten, niet twee: na het wegfilteren van de afgewezen
  // vertrouwde keuze blijven er twee over — dus nog steeds een echt
  // twijfelgeval (MATCHED_REVIEW_REQUIRED), niet toevallig weer de enige optie.
  const result = matchProduct({
    candidates: [candidate({ id: "p1" }), candidate({ id: "p2" }), candidate({ id: "p3" })],
    trusted: { productId: "p1", timesChosen: 3 },
    rejectedProductIds: new Set(["p1"]),
    now: NOW,
  });
  assert.equal(result.status, "MATCHED_REVIEW_REQUIRED");
  assert.notEqual(result.productId, "p1");
});

test("vertrouwde keuze afgewezen mét precies één overgebleven kandidaat -> die ene is alsnog MATCHED_TRUSTED", () => {
  // Geen ambiguïteit meer zodra er nog maar één optie over is, ook al kwam
  // die niet uit een eerdere voorkeur.
  const result = matchProduct({
    candidates: [candidate({ id: "p1" }), candidate({ id: "p2" })],
    trusted: { productId: "p1", timesChosen: 3 },
    rejectedProductIds: new Set(["p1"]),
    now: NOW,
  });
  assert.equal(result.status, "MATCHED_TRUSTED");
  assert.equal(result.productId, "p2");
});

test("vertrouwde keuze die niet meer beschikbaar is -> UNAVAILABLE, geen stille aanname", () => {
  const result = matchProduct({
    candidates: [candidate({ id: "p1", lastSeenAvailable: STALE })],
    trusted: { productId: "p1", timesChosen: 5 },
    rejectedProductIds: new Set(),
    now: NOW,
  });
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.productId, "p1");
});

test("geen kandidaat is beschikbaar (allemaal verlopen) -> UNAVAILABLE", () => {
  const result = matchProduct({
    candidates: [candidate({ id: "p1", lastSeenAvailable: STALE }), candidate({ id: "p2", lastSeenAvailable: null })],
    trusted: null,
    rejectedProductIds: new Set(),
    now: NOW,
  });
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.productId, null);
});

test("confidence stijgt met timesChosen maar blijft onder 1", () => {
  const low = matchProduct({
    candidates: [candidate({ id: "p1" })],
    trusted: { productId: "p1", timesChosen: 1 },
    rejectedProductIds: new Set(),
    now: NOW,
  });
  const high = matchProduct({
    candidates: [candidate({ id: "p1" })],
    trusted: { productId: "p1", timesChosen: 10 },
    rejectedProductIds: new Set(),
    now: NOW,
  });
  assert.ok(high.confidence > low.confidence);
  assert.ok(high.confidence < 1);
});
