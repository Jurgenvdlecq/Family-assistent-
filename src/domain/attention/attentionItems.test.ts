import { test } from "node:test";
import assert from "node:assert/strict";
import { getAttentionItems, type AttentionInput } from "./attentionItems";

function baseInput(overrides: Partial<AttentionInput> = {}): AttentionInput {
  return {
    mealPlanCreatedAt: new Date("2026-07-27T08:00:00Z"),
    hasShoppingList: true,
    reviewCount: 0,
    reviewFlaggedAt: null,
    shoppingListStatus: "PREPARED",
    reviewedAt: null,
    hasTransferredLines: false,
    lastTransferredAt: null,
    orderConfirmedAt: null,
    ...overrides,
  };
}

test("niets openstaand -> lege lijst", () => {
  const items = getAttentionItems(baseInput());
  assert.deepEqual(items, []);
});

test("geen boodschappenlijst -> WEEK_MENU_READY_NO_GROCERIES", () => {
  const items = getAttentionItems(baseInput({ hasShoppingList: false }));
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "WEEK_MENU_READY_NO_GROCERIES");
  assert.deepEqual(items[0].relevantSince, new Date("2026-07-27T08:00:00Z"));
});

test("openstaande productcontrole -> PRODUCT_REVIEW_OPEN met juist aantal in de titel", () => {
  const flaggedAt = new Date("2026-07-28T09:00:00Z");
  const items = getAttentionItems(baseInput({ reviewCount: 3, reviewFlaggedAt: flaggedAt }));
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "PRODUCT_REVIEW_OPEN");
  assert.match(items[0].title, /3 productkeuzes/);
  assert.deepEqual(items[0].relevantSince, flaggedAt);
});

test("enkelvoud in titel bij precies 1 openstaande productkeuze", () => {
  const items = getAttentionItems(
    baseInput({ reviewCount: 1, reviewFlaggedAt: new Date("2026-07-28T09:00:00Z") })
  );
  assert.match(items[0].title, /1 productkeuze controleren/);
});

test("lijst gecontroleerd maar nog niets verstuurd -> GROCERIES_READY_NOT_SENT_TO_PICNIC", () => {
  const reviewedAt = new Date("2026-07-28T10:00:00Z");
  const items = getAttentionItems(
    baseInput({ shoppingListStatus: "REVIEWED", reviewedAt })
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "GROCERIES_READY_NOT_SENT_TO_PICNIC");
  assert.deepEqual(items[0].relevantSince, reviewedAt);
});

test("mandje gevuld maar niet bevestigd -> PICNIC_CART_FILLED_NOT_CONFIRMED", () => {
  const transferredAt = new Date("2026-07-28T12:00:00Z");
  const items = getAttentionItems(
    baseInput({
      shoppingListStatus: "TRANSFERRED",
      hasTransferredLines: true,
      lastTransferredAt: transferredAt,
    })
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "PICNIC_CART_FILLED_NOT_CONFIRMED");
  assert.deepEqual(items[0].relevantSince, transferredAt);
});

test("mandje gevuld én bevestigd -> geen melding meer", () => {
  const items = getAttentionItems(
    baseInput({
      shoppingListStatus: "TRANSFERRED",
      hasTransferredLines: true,
      lastTransferredAt: new Date("2026-07-28T12:00:00Z"),
      orderConfirmedAt: new Date("2026-07-28T12:30:00Z"),
    })
  );
  assert.deepEqual(items, []);
});

test("lijst REVIEWED maar al deels verstuurd -> geen GROCERIES_READY_NOT_SENT_TO_PICNIC (het mandje-item wint)", () => {
  const items = getAttentionItems(
    baseInput({
      shoppingListStatus: "REVIEWED",
      reviewedAt: new Date("2026-07-28T10:00:00Z"),
      hasTransferredLines: true,
      lastTransferredAt: new Date("2026-07-28T12:00:00Z"),
    })
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "PICNIC_CART_FILLED_NOT_CONFIRMED");
});

test("gedeeltelijke afronding: mandje al gevuld én nog een productkeuze open -> mandje-item staat eerst (prioriteit)", () => {
  const items = getAttentionItems(
    baseInput({
      reviewCount: 1,
      reviewFlaggedAt: new Date("2026-07-27T09:00:00Z"),
      hasTransferredLines: true,
      lastTransferredAt: new Date("2026-07-28T12:00:00Z"),
    })
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].type, "PICNIC_CART_FILLED_NOT_CONFIRMED");
  assert.equal(items[1].type, "PRODUCT_REVIEW_OPEN");
});

test("dedupeKey is stabiel per dag en verschilt per type", () => {
  const items = getAttentionItems(
    baseInput({ reviewCount: 1, reviewFlaggedAt: new Date("2026-07-28T09:00:00Z") })
  );
  assert.equal(items[0].dedupeKey, "PRODUCT_REVIEW_OPEN:2026-07-28");
});
