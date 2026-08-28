import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfirmationSummary, type ConfirmationLineInput } from "./confirmationSummary";

function line(overrides: Partial<ConfirmationLineInput> = {}): ConfirmationLineInput {
  return {
    ingredientName: "Melk",
    source: "FIXED",
    matchStatus: "MATCHED_TRUSTED",
    transferredToPicnicAt: null,
    product: { name: "Volle melk", price: 1.29, lastSeenAvailable: new Date("2026-07-20") },
    ...overrides,
  };
}

test("buildConfirmationSummary: telt totaal en al-overgedragen apart", () => {
  const summary = buildConfirmationSummary([
    line(),
    line({ ingredientName: "Kaas", transferredToPicnicAt: new Date("2026-07-25") }),
  ]);
  assert.equal(summary.productCount, 2);
  assert.equal(summary.alreadyTransferredCount, 1);
  assert.equal(summary.toTransferCount, 1);
});

test("buildConfirmationSummary: telt bekende prijzen op, telt onbekende apart", () => {
  const summary = buildConfirmationSummary([
    line({ product: { name: "Volle melk", price: 1.29, lastSeenAvailable: new Date("2026-07-20") } }),
    line({ ingredientName: "Bloem", product: { name: "Bloem", price: null, lastSeenAvailable: null } }),
  ]);
  assert.equal(summary.expectedTotalPrice, 1.29);
  assert.equal(summary.unknownPriceCount, 1);
});

test("buildConfirmationSummary: rekent bekende prijzen met het aantal verpakkingen", () => {
  const summary = buildConfirmationSummary([
    line({
      ingredientName: "Aardappelen",
      packageCount: 4,
      product: { name: "Aardappeltjes", price: 1.79, lastSeenAvailable: new Date("2026-07-20") },
    }),
  ]);
  assert.equal(summary.expectedTotalPrice, 7.16);
});

test("buildConfirmationSummary: nooit een prijs verzinnen als alles onbekend is", () => {
  const summary = buildConfirmationSummary([
    line({ product: { name: "X", price: null, lastSeenAvailable: null } }),
  ]);
  assert.equal(summary.expectedTotalPrice, 0);
  assert.equal(summary.unknownPriceCount, 1);
});

test("buildConfirmationSummary: signaleert handmatig gekozen en niet-leverbare regels", () => {
  const summary = buildConfirmationSummary([
    line({ ingredientName: "Pindakaas", matchStatus: "MANUALLY_SELECTED" }),
    line({ ingredientName: "Exotisch fruit", matchStatus: "NOT_FOUND", product: null }),
  ]);
  assert.deepEqual(summary.manuallySelected, ["Pindakaas"]);
  assert.deepEqual(summary.unavailable, ["Exotisch fruit"]);
});

test("buildConfirmationSummary: al overgedragen regels tellen niet mee voor afwijkingen", () => {
  const summary = buildConfirmationSummary([
    line({
      ingredientName: "Oud manueel",
      matchStatus: "MANUALLY_SELECTED",
      transferredToPicnicAt: new Date("2026-07-25"),
    }),
  ]);
  assert.deepEqual(summary.manuallySelected, []);
  assert.equal(summary.alreadyTransferredCount, 1);
});

test("buildConfirmationSummary: oudste prijscontrole onder de over te dragen regels", () => {
  const summary = buildConfirmationSummary([
    line({ product: { name: "A", price: 1, lastSeenAvailable: new Date("2026-07-10") } }),
    line({ ingredientName: "B", product: { name: "B", price: 2, lastSeenAvailable: new Date("2026-07-22") } }),
  ]);
  assert.equal(summary.oldestPriceCheck?.toISOString(), new Date("2026-07-10").toISOString());
});

test("buildConfirmationSummary: lege lijst geeft nulwaarden", () => {
  const summary = buildConfirmationSummary([]);
  assert.equal(summary.productCount, 0);
  assert.equal(summary.expectedTotalPrice, 0);
  assert.equal(summary.oldestPriceCheck, null);
});

test("buildConfirmationSummary: splitst de over te dragen producten uit per herkomst", () => {
  const summary = buildConfirmationSummary([
    line({ source: "FIXED" }),
    line({ ingredientName: "Kaas", source: "FIXED" }),
    line({ ingredientName: "Bananen", source: "MANUAL" }),
    line({ ingredientName: "Kipfilet", source: "MEAL" }),
    // Al overgedragen: telt nergens in de uitsplitsing mee, want die gaat
    // over wat er nú nog naar het mandje gaat.
    line({ ingredientName: "Rijst", source: "MEAL", transferredToPicnicAt: new Date("2026-07-25") }),
  ]);

  assert.deepEqual(summary.toTransferBySource, { FIXED: 2, MANUAL: 1, MEAL: 1, INVENTORY: 0 });
  assert.equal(
    summary.toTransferBySource.FIXED + summary.toTransferBySource.MANUAL + summary.toTransferBySource.MEAL,
    summary.toTransferCount,
    "de uitsplitsing moet optellen tot het getal dat de gebruiker op de knop ziet"
  );
});
