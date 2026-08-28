import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDeliverySlotsResponse,
  findPreferredDeliverySlotStatus,
  formatSlotWindow,
  groupDeliverySlotsByDay,
  shouldCheckDeliverySlotToday,
  type PicnicDeliverySlot,
} from "./deliverySlots";

// Vrijdag 31 juli 2026, 18:00-19:00 CEST = 16:00-17:00 UTC.
function fridaySlot(overrides: Partial<PicnicDeliverySlot> = {}): PicnicDeliverySlot {
  return {
    id: "slot-1",
    windowStart: new Date("2026-07-31T16:00:00Z"),
    windowEnd: new Date("2026-07-31T17:00:00Z"),
    isAvailable: true,
    ...overrides,
  };
}

test("parseDeliverySlotsResponse: geldige data wordt correct omgezet", () => {
  const slots = parseDeliverySlotsResponse([
    {
      slot_id: "abc123",
      window_start: "2026-07-31T16:00:00.000Z",
      window_end: "2026-07-31T17:00:00.000Z",
      is_available: true,
      selected: false,
      minimum_order_value: 3500,
    },
  ]);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].id, "abc123");
  assert.equal(slots[0].isAvailable, true);
  assert.equal(slots[0].minimumOrderValue, 35);
});

test("parseDeliverySlotsResponse: lege array blijft een lege array", () => {
  assert.deepEqual(parseDeliverySlotsResponse([]), []);
});

test("parseDeliverySlotsResponse: null/undefined geeft veilig een lege array, geen crash", () => {
  assert.deepEqual(parseDeliverySlotsResponse(null), []);
  assert.deepEqual(parseDeliverySlotsResponse(undefined), []);
});

test("parseDeliverySlotsResponse: onverwachte vorm (object i.p.v. array) geeft veilig een lege array", () => {
  assert.deepEqual(parseDeliverySlotsResponse({ delivery_slots: "oeps" }), []);
});

test("parseDeliverySlotsResponse: regels zonder herkenbare velden worden overgeslagen, de rest blijft staan", () => {
  const slots = parseDeliverySlotsResponse([
    { window_start: "niet-een-datum", window_end: "2026-07-31T17:00:00.000Z" },
    { slot_id: "geldig", window_start: "2026-07-31T16:00:00.000Z", window_end: "2026-07-31T17:00:00.000Z", is_available: true },
  ]);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].id, "geldig");
});

test("findPreferredDeliverySlotStatus: exact slot beschikbaar -> AVAILABLE", () => {
  const result = findPreferredDeliverySlotStatus({
    slots: [fridaySlot()],
    preferredDay: "FRIDAY",
    preferredTime: "18:00",
    windowMinutes: 60,
  });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.preferredSlot?.id, "slot-1");
  assert.match(result.message, /Volgens Picnic/);
});

test("findPreferredDeliverySlotStatus: exact tijdstip niet beschikbaar, alternatief binnen marge -> EXACT_TIME_UNAVAILABLE", () => {
  const result = findPreferredDeliverySlotStatus({
    slots: [
      fridaySlot({ isAvailable: false }), // 18:00-19:00 vol
      fridaySlot({
        id: "slot-2",
        windowStart: new Date("2026-07-31T15:00:00Z"), // 17:00-18:00 CEST
        windowEnd: new Date("2026-07-31T16:00:00Z"),
        isAvailable: true,
      }),
    ],
    preferredDay: "FRIDAY",
    preferredTime: "18:00",
    windowMinutes: 60,
  });
  assert.equal(result.status, "EXACT_TIME_UNAVAILABLE");
  assert.equal(result.nearbySlots.length, 1);
  assert.match(result.message, /lijkt niet meer beschikbaar/);
  assert.match(result.message, /alternatieven/);
});

test("findPreferredDeliverySlotStatus: geen alternatief binnen marge -> NO_NEARBY_SLOTS", () => {
  const result = findPreferredDeliverySlotStatus({
    slots: [
      fridaySlot({ isAvailable: false }), // 18:00-19:00 vol
      fridaySlot({
        id: "slot-far",
        windowStart: new Date("2026-07-31T08:00:00Z"), // 10:00-11:00 CEST — ver weg
        windowEnd: new Date("2026-07-31T09:00:00Z"),
        isAvailable: true,
      }),
    ],
    preferredDay: "FRIDAY",
    preferredTime: "18:00",
    windowMinutes: 60,
  });
  assert.equal(result.status, "NO_NEARBY_SLOTS");
  assert.equal(result.nearbySlots.length, 0);
});

test("findPreferredDeliverySlotStatus: geen slots op voorkeursdag -> NO_SLOTS_FOR_DAY", () => {
  const result = findPreferredDeliverySlotStatus({
    slots: [
      {
        id: "saturday-slot",
        windowStart: new Date("2026-08-01T16:00:00Z"),
        windowEnd: new Date("2026-08-01T17:00:00Z"),
        isAvailable: true,
      },
    ],
    preferredDay: "FRIDAY",
    preferredTime: "18:00",
    windowMinutes: 60,
  });
  assert.equal(result.status, "NO_SLOTS_FOR_DAY");
});

test("findPreferredDeliverySlotStatus: helemaal geen slots (lege lijst) -> NO_SLOTS_FOR_DAY", () => {
  const result = findPreferredDeliverySlotStatus({
    slots: [],
    preferredDay: "FRIDAY",
    preferredTime: "18:00",
    windowMinutes: 60,
  });
  assert.equal(result.status, "NO_SLOTS_FOR_DAY");
});

test("findPreferredDeliverySlotStatus: onbekende/onvolledige data (geparste lege slotenlijst) -> NO_SLOTS_FOR_DAY, geen crash", () => {
  const slots = parseDeliverySlotsResponse({ unexpected: true });
  const result = findPreferredDeliverySlotStatus({
    slots,
    preferredDay: "FRIDAY",
    preferredTime: "18:00",
    windowMinutes: 60,
  });
  assert.equal(result.status, "NO_SLOTS_FOR_DAY");
});

test("shouldCheckDeliverySlotToday: woensdag is 2 dagen vóór vrijdag", () => {
  // Woensdag 29 juli 2026, 10:00 CEST.
  const result = shouldCheckDeliverySlotToday({
    preferredDayOfWeek: "FRIDAY",
    reminderDaysBefore: 2,
    now: new Date("2026-07-29T08:00:00Z"),
  });
  assert.equal(result, true);
});

test("shouldCheckDeliverySlotToday: donderdag (1 dag ervoor) is geen match voor reminderDaysBefore=2", () => {
  const result = shouldCheckDeliverySlotToday({
    preferredDayOfWeek: "FRIDAY",
    reminderDaysBefore: 2,
    now: new Date("2026-07-30T08:00:00Z"),
  });
  assert.equal(result, false);
});

test("shouldCheckDeliverySlotToday: dinsdag (3 dagen ervoor) is ook geen match voor reminderDaysBefore=2", () => {
  const result = shouldCheckDeliverySlotToday({
    preferredDayOfWeek: "FRIDAY",
    reminderDaysBefore: 2,
    now: new Date("2026-07-28T08:00:00Z"),
  });
  assert.equal(result, false);
});

test("shouldCheckDeliverySlotToday: werkt ook rond een weekgrens (maandag - 2 dagen = zaterdag)", () => {
  // Zaterdag 25 juli 2026.
  const result = shouldCheckDeliverySlotToday({
    preferredDayOfWeek: "MONDAY",
    reminderDaysBefore: 2,
    now: new Date("2026-07-25T08:00:00Z"),
  });
  assert.equal(result, true);
});

test("shouldCheckDeliverySlotToday: reminderDaysBefore=0 betekent 'controleer op de bezorgdag zelf'", () => {
  const result = shouldCheckDeliverySlotToday({
    preferredDayOfWeek: "FRIDAY",
    reminderDaysBefore: 0,
    now: new Date("2026-07-31T08:00:00Z"),
  });
  assert.equal(result, true);
});

// --- groupDeliverySlotsByDay (WP: bezorgmomenten-overzicht) ---

function slot(id: string, startIso: string, endIso: string, isAvailable = true): PicnicDeliverySlot {
  return { id, windowStart: new Date(startIso), windowEnd: new Date(endIso), isAvailable };
}

test("groupDeliverySlotsByDay: bundelt per bezorgdag en sorteert dagen én tijdvakken oplopend", () => {
  // Bewust door elkaar aangeleverd, om te bewijzen dat we zelf sorteren.
  const groups = groupDeliverySlotsByDay([
    slot("za-mid", "2026-09-05T08:00:00Z", "2026-09-05T10:00:00Z"),
    slot("do-laat", "2026-09-03T18:00:00Z", "2026-09-03T19:00:00Z"),
    slot("do-vroeg", "2026-09-03T16:00:00Z", "2026-09-03T17:00:00Z"),
  ]);

  assert.deepEqual(
    groups.map((group) => group.isoDate),
    ["2026-09-03", "2026-09-05"]
  );
  assert.deepEqual(groups[0].availableSlots.map((s) => s.id), ["do-vroeg", "do-laat"]);
  assert.equal(groups[0].dayKey, "thursday");
  assert.equal(groups[0].label, "do 3 sep");
});

test("groupDeliverySlotsByDay: een dag waarop alles vol zit blijft zichtbaar, met 0 vrije tijdvakken", () => {
  const groups = groupDeliverySlotsByDay([
    slot("vol-1", "2026-09-04T16:00:00Z", "2026-09-04T17:00:00Z", false),
    slot("vol-2", "2026-09-04T18:00:00Z", "2026-09-04T19:00:00Z", false),
  ]);

  assert.equal(groups.length, 1, "de dag zelf mag niet verdwijnen — anders lijkt hij simpelweg niet te bestaan");
  assert.equal(groups[0].availableSlots.length, 0);
  assert.equal(groups[0].unavailableCount, 2);
});

test("groupDeliverySlotsByDay: groepeert op Nederlandse kalenderdag, niet op UTC-dag", () => {
  // 23:30 UTC op 3 sep = 01:30 Nederlandse tijd op 4 sep (zomertijd, UTC+2).
  const groups = groupDeliverySlotsByDay([slot("nacht", "2026-09-03T23:30:00Z", "2026-09-04T00:30:00Z")]);

  assert.equal(groups[0].isoDate, "2026-09-04");
  assert.equal(groups[0].dayKey, "friday");
});

test("groupDeliverySlotsByDay: geen sloten geeft een lege lijst, geen crash", () => {
  assert.deepEqual(groupDeliverySlotsByDay([]), []);
});

test("formatSlotWindow: toont het tijdvak in Nederlandse tijd", () => {
  assert.equal(formatSlotWindow(slot("x", "2026-09-03T16:00:00Z", "2026-09-03T17:00:00Z")), "18:00–19:00");
});
