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
