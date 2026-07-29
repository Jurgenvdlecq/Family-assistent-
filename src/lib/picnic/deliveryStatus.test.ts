/**
 * Integratietest tegen een echte (lokale) Postgres — alleen de externe
 * Picnic-HTTP-aanroep wordt vervangen door een fake fetch (zelfde patroon
 * als cartService.test.ts/accountConnection.test.ts).
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../prisma";
import { getPreferredDeliverySlotStatusForHousehold } from "./deliveryStatus";

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", ...headers } });
}

async function makeHousehold(name: string) {
  return prisma.household.create({
    data: { name, persons: { create: [{ name: "Test", role: "PARENT" }] } },
  });
}

async function cleanup(householdId: string) {
  await prisma.household.delete({ where: { id: householdId } });
}

test("getPreferredDeliverySlotStatusForHousehold: geeft een concrete status terug bij een geldige respons", async () => {
  const household = await makeHousehold("WP71 integratietest — geldige respons");
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
    const status = await getPreferredDeliverySlotStatusForHousehold({
      householdId: household.id,
      picnicAuthToken: "token",
      preferredDay: "FRIDAY",
      preferredTime: "18:00",
      windowMinutes: 60,
    });
    assert.equal(status.status, "AVAILABLE");
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});

test("getPreferredDeliverySlotStatusForHousehold: verlopen Picnic-sessie geeft UNKNOWN met een voorzichtige tekst, geen crash", async () => {
  const household = await makeHousehold("WP71 integratietest — verlopen sessie");
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    jsonResponse({ error: { code: "AUTH_ERROR", message: "niet ingelogd" } })) as typeof fetch;
  try {
    const status = await getPreferredDeliverySlotStatusForHousehold({
      householdId: household.id,
      picnicAuthToken: "token",
      preferredDay: "FRIDAY",
      preferredTime: "18:00",
      windowMinutes: 60,
    });
    assert.equal(status.status, "UNKNOWN");
    assert.equal(status.message, "Picnic kon nu niet worden gecontroleerd.");
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});

test("getPreferredDeliverySlotStatusForHousehold: netwerkfout geeft UNKNOWN, geen crash", async () => {
  const household = await makeHousehold("WP71 integratietest — netwerkfout");
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    throw new Error("connect ECONNREFUSED");
  }) as typeof fetch;
  try {
    const status = await getPreferredDeliverySlotStatusForHousehold({
      householdId: household.id,
      picnicAuthToken: "token",
      preferredDay: "FRIDAY",
      preferredTime: "18:00",
      windowMinutes: 60,
    });
    assert.equal(status.status, "UNKNOWN");
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});

test("getPreferredDeliverySlotStatusForHousehold: een ververst token wordt opgeslagen, net als bij andere Picnic-acties", async () => {
  const household = await makeHousehold("WP71 integratietest — tokenrefresh");
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    jsonResponse({ delivery_slots: [] }, { "x-picnic-auth": "nieuw-token"})) as typeof fetch;
  try {
    await getPreferredDeliverySlotStatusForHousehold({
      householdId: household.id,
      picnicAuthToken: "oud-token",
      preferredDay: "FRIDAY",
      preferredTime: "18:00",
      windowMinutes: 60,
    });
    const updated = await prisma.household.findUniqueOrThrow({ where: { id: household.id } });
    assert.equal(updated.picnicAuthToken, "nieuw-token");
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});
