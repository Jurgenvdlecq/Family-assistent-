import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isWithinNotificationWindow,
  notificationDayKey,
  selectNotificationToSend,
} from "./notificationPolicy";
import type { AttentionItem } from "./attentionItems";

function item(overrides: Partial<AttentionItem> & Pick<AttentionItem, "type" | "relevantSince">): AttentionItem {
  return {
    title: "Titel",
    body: "Tekst",
    href: "/",
    cta: "Bekijk",
    urgency: "normal",
    dedupeKey: "x",
    ...overrides,
  };
}

test("isWithinNotificationWindow: 07:59 Amsterdam-tijd (zomertijd, UTC+2) valt buiten het venster", () => {
  // 05:59 UTC = 07:59 CEST
  assert.equal(isWithinNotificationWindow(new Date("2026-07-15T05:59:00Z")), false);
});

test("isWithinNotificationWindow: 08:00 Amsterdam-tijd valt binnen het venster", () => {
  assert.equal(isWithinNotificationWindow(new Date("2026-07-15T06:00:00Z")), true);
});

test("isWithinNotificationWindow: 20:59 Amsterdam-tijd valt nog binnen het venster", () => {
  assert.equal(isWithinNotificationWindow(new Date("2026-07-15T18:59:00Z")), true);
});

test("isWithinNotificationWindow: 21:00 Amsterdam-tijd valt buiten het venster", () => {
  assert.equal(isWithinNotificationWindow(new Date("2026-07-15T19:00:00Z")), false);
});

test("isWithinNotificationWindow: houdt rekening met wintertijd (UTC+1)", () => {
  // 07:00 UTC = 08:00 CET (januari, wintertijd)
  assert.equal(isWithinNotificationWindow(new Date("2026-01-15T07:00:00Z")), true);
  assert.equal(isWithinNotificationWindow(new Date("2026-01-15T06:59:00Z")), false);
});

test("notificationDayKey geeft de Amsterdamse kalenderdag, ook rond middernacht UTC", () => {
  // 23:30 UTC op 14 juli = 01:30 CEST op 15 juli
  assert.equal(notificationDayKey(new Date("2026-07-14T23:30:00Z")), "2026-07-15");
});

test("selectNotificationToSend: kiest niets als er geen items zijn", () => {
  const result = selectNotificationToSend({
    items: [],
    now: new Date("2026-07-30T10:00:00Z"),
    preferenceEnabledByType: {},
    typesAlreadySentToday: new Set(),
    householdAlreadySentAnyToday: false,
  });
  assert.equal(result, null);
});

test("selectNotificationToSend: respecteert de huishouden-brede dagelijkse cap", () => {
  const result = selectNotificationToSend({
    items: [item({ type: "WEEK_MENU_READY_NO_GROCERIES", relevantSince: new Date("2026-07-01T00:00:00Z") })],
    now: new Date("2026-07-30T10:00:00Z"),
    preferenceEnabledByType: {},
    typesAlreadySentToday: new Set(),
    householdAlreadySentAnyToday: true,
  });
  assert.equal(result, null);
});

test("selectNotificationToSend: negeert een uitgezet type", () => {
  const result = selectNotificationToSend({
    items: [item({ type: "WEEK_MENU_READY_NO_GROCERIES", relevantSince: new Date("2026-07-01T00:00:00Z") })],
    now: new Date("2026-07-30T10:00:00Z"),
    preferenceEnabledByType: { WEEK_MENU_READY_NO_GROCERIES: false },
    typesAlreadySentToday: new Set(),
    householdAlreadySentAnyToday: false,
  });
  assert.equal(result, null);
});

test("selectNotificationToSend: negeert een type dat vandaag al gestuurd is", () => {
  const result = selectNotificationToSend({
    items: [item({ type: "WEEK_MENU_READY_NO_GROCERIES", relevantSince: new Date("2026-07-01T00:00:00Z") })],
    now: new Date("2026-07-30T10:00:00Z"),
    preferenceEnabledByType: {},
    typesAlreadySentToday: new Set(["WEEK_MENU_READY_NO_GROCERIES"]),
    householdAlreadySentAnyToday: false,
  });
  assert.equal(result, null);
});

test("selectNotificationToSend: wacht tot de wachttijd voor dit type verstreken is", () => {
  const relevantSince = new Date("2026-07-30T09:00:00Z"); // net 1 uur geleden
  const result = selectNotificationToSend({
    items: [item({ type: "GROCERIES_READY_NOT_SENT_TO_PICNIC", relevantSince })],
    now: new Date("2026-07-30T10:00:00Z"),
    preferenceEnabledByType: {},
    typesAlreadySentToday: new Set(),
    householdAlreadySentAnyToday: false,
  });
  assert.equal(result, null, "24 uur is nog niet verstreken");
});

test("selectNotificationToSend: stuurt zodra de wachttijd verstreken is", () => {
  const relevantSince = new Date("2026-07-28T09:00:00Z"); // > 24 uur geleden
  const target = item({ type: "GROCERIES_READY_NOT_SENT_TO_PICNIC", relevantSince });
  const result = selectNotificationToSend({
    items: [target],
    now: new Date("2026-07-30T10:00:00Z"),
    preferenceEnabledByType: {},
    typesAlreadySentToday: new Set(),
    householdAlreadySentAnyToday: false,
  });
  assert.equal(result, target);
});

test("selectNotificationToSend: productcontrole moet echt 2 dagen open staan, niet 1", () => {
  const relevantSinceOneDay = new Date("2026-07-29T10:00:00Z");
  const result = selectNotificationToSend({
    items: [item({ type: "PRODUCT_REVIEW_OPEN", relevantSince: relevantSinceOneDay })],
    now: new Date("2026-07-30T10:00:00Z"),
    preferenceEnabledByType: {},
    typesAlreadySentToday: new Set(),
    householdAlreadySentAnyToday: false,
  });
  assert.equal(result, null);
});

test("selectNotificationToSend: slaat een niet-verzendbaar item over en kiest het volgende", () => {
  const notYet = item({ type: "PICNIC_CART_FILLED_NOT_CONFIRMED", relevantSince: new Date("2026-07-30T09:30:00Z") });
  const ready = item({ type: "GROCERIES_READY_NOT_SENT_TO_PICNIC", relevantSince: new Date("2026-07-28T09:00:00Z") });
  const result = selectNotificationToSend({
    items: [notYet, ready],
    now: new Date("2026-07-30T10:00:00Z"),
    preferenceEnabledByType: {},
    typesAlreadySentToday: new Set(),
    householdAlreadySentAnyToday: false,
  });
  assert.equal(result, ready);
});
