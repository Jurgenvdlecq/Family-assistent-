/**
 * Integratietest tegen een echte (lokale) Postgres — alleen de externe
 * Picnic-HTTP-aanroep wordt vervangen door een fake fetch (zelfde patroon
 * als cartService.test.ts/accountConnection.test.ts).
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../prisma";
import { getDeliveryOverviewForHousehold, getPreferredDeliverySlotStatusForHousehold } from "./deliveryStatus";

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

// --- getDeliveryOverviewForHousehold (WP: bezorgmomenten-overzicht) ---

const TWO_DAYS = [
  // Donderdag 3 sep 2026: 18:00-19:00 vrij, 20:00-21:00 vol.
  { slot_id: "do-vrij", window_start: "2026-09-03T16:00:00.000Z", window_end: "2026-09-03T17:00:00.000Z", is_available: true },
  { slot_id: "do-vol", window_start: "2026-09-03T18:00:00.000Z", window_end: "2026-09-03T19:00:00.000Z", is_available: false },
  // Vrijdag 4 sep 2026: 18:00-19:00 vrij.
  { slot_id: "vr-vrij", window_start: "2026-09-04T16:00:00.000Z", window_end: "2026-09-04T17:00:00.000Z", is_available: true },
];

test("getDeliveryOverviewForHousehold: geeft alle bezorgdagen terug, niet alleen de voorkeursdag", async () => {
  const household = await makeHousehold("Bezorgoverzicht — alle dagen");
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = (async () => {
    callCount += 1;
    return jsonResponse({ delivery_slots: TWO_DAYS });
  }) as typeof fetch;
  try {
    const overview = await getDeliveryOverviewForHousehold({
      householdId: household.id,
      picnicAuthToken: "token",
      preference: { preferredDayOfWeek: "FRIDAY", preferredTime: "18:00", windowMinutes: 60 },
    });

    assert.equal(overview.error, null);
    assert.deepEqual(overview.groups.map((group) => group.isoDate), ["2026-09-03", "2026-09-04"]);
    // Donderdag: één vrij tijdvak zichtbaar, het volle tijdvak alleen geteld.
    assert.deepEqual(overview.groups[0].availableSlots.map((slot) => slot.id), ["do-vrij"]);
    assert.equal(overview.groups[0].unavailableCount, 1);
    // De voorkeursstatus komt uit dezelfde ophaalactie, niet uit een tweede aanroep.
    assert.equal(overview.preferred?.status, "AVAILABLE");
    assert.equal(callCount, 1, "overzicht en voorkeursstatus moeten samen één Picnic-aanroep kosten");
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});

test("getDeliveryOverviewForHousehold: zonder ingesteld voorkeursmoment blijft het overzicht gewoon werken", async () => {
  const household = await makeHousehold("Bezorgoverzicht — geen voorkeur");
  const originalFetch = global.fetch;
  global.fetch = (async () => jsonResponse({ delivery_slots: TWO_DAYS })) as typeof fetch;
  try {
    const overview = await getDeliveryOverviewForHousehold({
      householdId: household.id,
      picnicAuthToken: "token",
      preference: null,
    });
    assert.equal(overview.preferred, null);
    assert.equal(overview.groups.length, 2, "het overzicht hangt niet af van een ingestelde voorkeur");
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});

test("getDeliveryOverviewForHousehold: verlopen sessie geeft error 'auth', geen crash", async () => {
  const household = await makeHousehold("Bezorgoverzicht — verlopen sessie");
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    jsonResponse({ error: { code: "AUTH_ERROR", message: "niet ingelogd" } })) as typeof fetch;
  try {
    const overview = await getDeliveryOverviewForHousehold({
      householdId: household.id,
      picnicAuthToken: "token",
      preference: null,
    });
    assert.equal(overview.error, "auth");
    assert.deepEqual(overview.groups, []);
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});

test("getDeliveryOverviewForHousehold: netwerkfout geeft error 'other', geen crash", async () => {
  const household = await makeHousehold("Bezorgoverzicht — netwerkfout");
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    throw new Error("connect ECONNREFUSED");
  }) as typeof fetch;
  try {
    const overview = await getDeliveryOverviewForHousehold({
      householdId: household.id,
      picnicAuthToken: "token",
      preference: null,
    });
    assert.equal(overview.error, "other");
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});
