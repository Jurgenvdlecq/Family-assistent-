/**
 * Integratietest tegen een echte (lokale) Postgres. `sendFn` (het
 * injectiepunt in runReminderSweepForHousehold, zelfde patroon als de
 * `now`-parameter elders) vervangt hier de echte `sendPushNotification` —
 * web-push praat altijd via HTTPS met de pushprovider, dus faken op dit
 * niveau is eenvoudiger en betrouwbaarder dan een lokale HTTPS-server met
 * zelfondertekend certificaat opzetten.
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { runReminderSweepForHousehold } from "./notifications";
import { getCurrentWeekStart } from "./week";
import { notificationDayKey } from "@/domain/attention/notificationPolicy";
import type { PushSendResult } from "./webPush";

function fakeSendFn(outcome: PushSendResult["outcome"]) {
  return async (): Promise<PushSendResult> =>
    outcome === "error" ? { outcome: "error", message: "test-fout" } : { outcome };
}

async function makeHouseholdWithOldMealPlan(name: string) {
  const household = await prisma.household.create({
    data: { name, persons: { create: [{ name: "Test", role: "PARENT" }] } },
  });
  const weekStart = getCurrentWeekStart();
  const mealPlan = await prisma.mealPlan.create({ data: { householdId: household.id, weekStart, status: "CONCEPT" } });
  // Simuleer "weekmenu al meer dan 24 uur oud, nog geen boodschappenlijst" —
  // zonder dit zou WEEK_MENU_READY_NO_GROCERIES nooit verzendbaar zijn.
  await prisma.mealPlan.update({
    where: { id: mealPlan.id },
    data: { createdAt: new Date(Date.now() - 30 * 60 * 60 * 1000) },
  });
  return household;
}

// WP72: een vers weekmenu (net aangemaakt) laat WEEK_MENU_READY_NO_GROCERIES
// wél bestaan als attention-item, maar nog niet "verzendrijp" (dwell-drempel
// van 24u nog niet gehaald) — zo kan de bezorgmoment-kandidaat los getest
// worden zonder dat er een concurrerend item verzonden wordt.
async function makeHouseholdWithFreshMealPlan(name: string) {
  const household = await prisma.household.create({
    data: { name, persons: { create: [{ name: "Test", role: "PARENT" }] } },
  });
  const weekStart = getCurrentWeekStart();
  await prisma.mealPlan.create({ data: { householdId: household.id, weekStart, status: "CONCEPT" } });
  return household;
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", ...headers } });
}

async function setDeliveryPreference(
  householdId: string,
  overrides: Partial<{
    preferredDayOfWeek: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
    preferredTime: string;
    windowMinutes: number;
    reminderDaysBefore: number;
    notificationsEnabled: boolean;
  }> = {}
) {
  await prisma.picnicDeliveryPreference.create({
    data: {
      householdId,
      preferredDayOfWeek: overrides.preferredDayOfWeek ?? "FRIDAY",
      preferredTime: overrides.preferredTime ?? "18:00",
      windowMinutes: overrides.windowMinutes ?? 60,
      reminderDaysBefore: overrides.reminderDaysBefore ?? 2,
      notificationsEnabled: overrides.notificationsEnabled ?? true,
    },
  });
}

// Woensdag 12:00 Amsterdamse tijd — precies 2 dagen vóór vrijdag, de
// standaard `reminderDaysBefore`.
const WEDNESDAY_NOON = new Date("2026-07-29T10:00:00.000Z");
// Donderdag: niet de ingestelde herinnerdag voor een vrijdag-voorkeur.
const THURSDAY_NOON = new Date("2026-07-30T10:00:00.000Z");

async function addFakeSubscription(householdId: string) {
  return prisma.pushSubscription.create({
    data: {
      householdId,
      endpoint: `https://example.invalid/push/${crypto.randomUUID()}`,
      p256dh: "BCkOAEd2k2fubDI3CuUtt6-1KogOBcq08JgA6HvFo89RU3q__leqlHOC6Hc1pwTK9Dccbr9yIYHDHdMulWOPb2c",
      auth: "VZlA5Onf7dzRVoPOOxO52Q",
    },
  });
}

async function cleanup(householdId: string) {
  await prisma.notificationDeliveryLog.deleteMany({ where: { householdId } });
  await prisma.notificationPreference.deleteMany({ where: { householdId } });
  await prisma.picnicDeliveryPreference.deleteMany({ where: { householdId } });
  await prisma.pushSubscription.deleteMany({ where: { householdId } });
  await prisma.mealPlan.deleteMany({ where: { householdId } });
  await prisma.person.deleteMany({ where: { householdId } });
  await prisma.household.delete({ where: { id: householdId } });
}

test("runReminderSweepForHousehold: stuurt een melding en schrijft de delivery-log", async () => {
  const household = await makeHouseholdWithOldMealPlan("WP70 integratietest — succesvolle push");
  try {
    await addFakeSubscription(household.id);
    const result = await runReminderSweepForHousehold(household.id, new Date(), "test-correlation", fakeSendFn("sent"));
    assert.equal(result.sent, true);
    assert.equal(result.type, "WEEK_MENU_READY_NO_GROCERIES");

    const logs = await prisma.notificationDeliveryLog.findMany({ where: { householdId: household.id } });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].type, "WEEK_MENU_READY_NO_GROCERIES");
  } finally {
    await cleanup(household.id);
  }
});

test("runReminderSweepForHousehold: verzendt niet twee keer op dezelfde dag voor hetzelfde type", async () => {
  const household = await makeHouseholdWithOldMealPlan("WP70 integratietest — dedupe per dag");
  try {
    await addFakeSubscription(household.id);
    const now = new Date();
    const first = await runReminderSweepForHousehold(household.id, now, "test-correlation-1", fakeSendFn("sent"));
    assert.equal(first.sent, true);

    const second = await runReminderSweepForHousehold(household.id, now, "test-correlation-2", fakeSendFn("sent"));
    assert.equal(second.sent, false, "dezelfde dag, zelfde type -> niet nog een keer");

    const logs = await prisma.notificationDeliveryLog.findMany({ where: { householdId: household.id } });
    assert.equal(logs.length, 1);
  } finally {
    await cleanup(household.id);
  }
});

test("runReminderSweepForHousehold: respecteert een uitgeschakelde voorkeur voor dit type", async () => {
  const household = await makeHouseholdWithOldMealPlan("WP70 integratietest — voorkeur uit");
  try {
    await addFakeSubscription(household.id);
    await prisma.notificationPreference.create({
      data: { householdId: household.id, type: "WEEK_MENU_READY_NO_GROCERIES", enabled: false },
    });

    const result = await runReminderSweepForHousehold(household.id, new Date(), "test-correlation", fakeSendFn("sent"));
    assert.equal(result.sent, false);

    const logs = await prisma.notificationDeliveryLog.findMany({ where: { householdId: household.id } });
    assert.equal(logs.length, 0);
  } finally {
    await cleanup(household.id);
  }
});

test("runReminderSweepForHousehold: schakelt een verlopen subscription uit (410 Gone) en stuurt geen melding", async () => {
  const household = await makeHouseholdWithOldMealPlan("WP70 integratietest — verlopen subscription");
  try {
    const subscription = await addFakeSubscription(household.id);
    const result = await runReminderSweepForHousehold(household.id, new Date(), "test-correlation", fakeSendFn("gone"));
    assert.equal(result.sent, false);

    const updated = await prisma.pushSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
    assert.notEqual(updated.disabledAt, null);

    const logs = await prisma.notificationDeliveryLog.findMany({ where: { householdId: household.id } });
    assert.equal(logs.length, 0, "geen geslaagde verzending -> geen delivery-log");
  } finally {
    await cleanup(household.id);
  }
});

test("runReminderSweepForHousehold: geen actieve subscriptions -> niets te versturen, geen crash", async () => {
  const household = await makeHouseholdWithOldMealPlan("WP70 integratietest — geen subscriptions");
  try {
    const result = await runReminderSweepForHousehold(household.id, new Date(), "test-correlation", fakeSendFn("sent"));
    assert.equal(result.sent, false);
  } finally {
    await cleanup(household.id);
  }
});

test("runReminderSweepForHousehold: een verzendfout schakelt de subscription niet uit en logt geen melding", async () => {
  const household = await makeHouseholdWithOldMealPlan("WP70 integratietest — verzendfout");
  try {
    const subscription = await addFakeSubscription(household.id);
    const result = await runReminderSweepForHousehold(household.id, new Date(), "test-correlation", fakeSendFn("error"));
    assert.equal(result.sent, false);

    const updated = await prisma.pushSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
    assert.equal(updated.disabledAt, null, "een tijdelijke fout mag de subscription niet uitschakelen");
  } finally {
    await cleanup(household.id);
  }
});

test("runReminderSweepForHousehold (WP72): stuurt een melding als het bezorgmoment risico loopt, op de ingestelde herinnerdag", async () => {
  const household = await makeHouseholdWithFreshMealPlan("WP72 integratietest — bezorgmoment risico");
  const originalFetch = global.fetch;
  global.fetch = (async () => jsonResponse({ delivery_slots: [] })) as typeof fetch;
  try {
    await prisma.household.update({ where: { id: household.id }, data: { picnicAuthToken: "token" } });
    await setDeliveryPreference(household.id);
    await addFakeSubscription(household.id);

    const result = await runReminderSweepForHousehold(
      household.id,
      WEDNESDAY_NOON,
      "test-correlation",
      fakeSendFn("sent")
    );
    assert.equal(result.sent, true);
    assert.equal(result.type, "PICNIC_DELIVERY_SLOT_AT_RISK");

    const logs = await prisma.notificationDeliveryLog.findMany({ where: { householdId: household.id } });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].type, "PICNIC_DELIVERY_SLOT_AT_RISK");
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});

test("runReminderSweepForHousehold (WP72): stuurt geen melding als het voorkeursmoment nog gewoon beschikbaar is", async () => {
  const household = await makeHouseholdWithFreshMealPlan("WP72 integratietest — moment nog beschikbaar");
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    jsonResponse({
      delivery_slots: [
        {
          slot_id: "abc",
          window_start: "2026-07-31T16:00:00.000Z",
          window_end: "2026-07-31T17:00:00.000Z",
          is_available: true,
        },
      ],
    })) as typeof fetch;
  try {
    await prisma.household.update({ where: { id: household.id }, data: { picnicAuthToken: "token" } });
    await setDeliveryPreference(household.id);
    await addFakeSubscription(household.id);

    const result = await runReminderSweepForHousehold(
      household.id,
      WEDNESDAY_NOON,
      "test-correlation",
      fakeSendFn("sent")
    );
    assert.equal(result.sent, false);
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});

test("runReminderSweepForHousehold (WP72): controleert Picnic niet buiten de ingestelde herinnerdag", async () => {
  const household = await makeHouseholdWithFreshMealPlan("WP72 integratietest — verkeerde dag");
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    throw new Error("Picnic had niet aangeroepen mogen worden op de verkeerde dag");
  }) as typeof fetch;
  try {
    await prisma.household.update({ where: { id: household.id }, data: { picnicAuthToken: "token" } });
    await setDeliveryPreference(household.id);
    await addFakeSubscription(household.id);

    const result = await runReminderSweepForHousehold(
      household.id,
      THURSDAY_NOON,
      "test-correlation",
      fakeSendFn("sent")
    );
    assert.equal(result.sent, false);
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});

test("runReminderSweepForHousehold (WP72): respecteert een uitgeschakelde bezorgmoment-melding", async () => {
  const household = await makeHouseholdWithFreshMealPlan("WP72 integratietest — melding uit");
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    throw new Error("Picnic had niet aangeroepen mogen worden bij een uitgeschakelde voorkeur");
  }) as typeof fetch;
  try {
    await prisma.household.update({ where: { id: household.id }, data: { picnicAuthToken: "token" } });
    await setDeliveryPreference(household.id, { notificationsEnabled: false });
    await addFakeSubscription(household.id);

    const result = await runReminderSweepForHousehold(
      household.id,
      WEDNESDAY_NOON,
      "test-correlation",
      fakeSendFn("sent")
    );
    assert.equal(result.sent, false);
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});

test("runReminderSweepForHousehold (WP72): geen Picnic-koppeling -> geen bezorgmoment-check", async () => {
  const household = await makeHouseholdWithFreshMealPlan("WP72 integratietest — geen Picnic-koppeling");
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    throw new Error("Picnic had niet aangeroepen mogen worden zonder gekoppeld account");
  }) as typeof fetch;
  try {
    await setDeliveryPreference(household.id);
    await addFakeSubscription(household.id);

    const result = await runReminderSweepForHousehold(
      household.id,
      WEDNESDAY_NOON,
      "test-correlation",
      fakeSendFn("sent")
    );
    assert.equal(result.sent, false);
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});

test("runReminderSweepForHousehold (WP72): een bestaand aandachtspunt wint, geen live Picnic-check nodig", async () => {
  const household = await makeHouseholdWithFreshMealPlan("WP72 integratietest — prioriteit voor bestaand aandachtspunt");
  const mealPlan = await prisma.mealPlan.findFirstOrThrow({ where: { householdId: household.id } });
  // Vast, niet van de echte systeemklok afhankelijk: 30 uur vóór WEDNESDAY_NOON,
  // zodat WEEK_MENU_READY_NO_GROCERIES gegarandeerd "verzendrijp" is (dwell-drempel 24u).
  await prisma.mealPlan.update({
    where: { id: mealPlan.id },
    data: { createdAt: new Date(WEDNESDAY_NOON.getTime() - 30 * 60 * 60 * 1000) },
  });
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    throw new Error("Picnic had niet aangeroepen mogen worden zolang er al een ander aandachtspunt is");
  }) as typeof fetch;
  try {
    await prisma.household.update({ where: { id: household.id }, data: { picnicAuthToken: "token" } });
    await setDeliveryPreference(household.id);
    await addFakeSubscription(household.id);

    const result = await runReminderSweepForHousehold(
      household.id,
      WEDNESDAY_NOON,
      "test-correlation",
      fakeSendFn("sent")
    );
    assert.equal(result.sent, true);
    assert.equal(result.type, "WEEK_MENU_READY_NO_GROCERIES");
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});

test("runReminderSweepForHousehold (WP72): al een melding vandaag verstuurd -> geen extra bezorgmoment-check", async () => {
  const household = await makeHouseholdWithFreshMealPlan("WP72 integratietest — al gestuurd vandaag");
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    throw new Error("Picnic had niet aangeroepen mogen worden als het huishouden vandaag al iets kreeg");
  }) as typeof fetch;
  try {
    await prisma.household.update({ where: { id: household.id }, data: { picnicAuthToken: "token" } });
    await setDeliveryPreference(household.id);
    await addFakeSubscription(household.id);
    await prisma.notificationDeliveryLog.create({
      data: { householdId: household.id, type: "PRODUCT_REVIEW_OPEN", dayKey: notificationDayKey(WEDNESDAY_NOON) },
    });

    const result = await runReminderSweepForHousehold(
      household.id,
      WEDNESDAY_NOON,
      "test-correlation",
      fakeSendFn("sent")
    );
    assert.equal(result.sent, false);
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});
