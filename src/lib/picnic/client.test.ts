import { test } from "node:test";
import assert from "node:assert/strict";
import { PicnicClient, PicnicAuthError, PicnicApiError, PicnicNetworkError } from "./client";

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", ...headers } });
}

test("PicnicClient: AUTH_ERROR van Picnic wordt een PicnicAuthError", async () => {
  const original = global.fetch;
  global.fetch = (async () =>
    jsonResponse({ error: { code: "AUTH_ERROR", message: "niet ingelogd" } })) as typeof fetch;
  try {
    const client = new PicnicClient("token");
    await assert.rejects(() => client.getUser(), PicnicAuthError);
  } finally {
    global.fetch = original;
  }
});

test("PicnicClient: overige foutcode van Picnic wordt een PicnicApiError, geen auth-fout", async () => {
  const original = global.fetch;
  global.fetch = (async () =>
    jsonResponse({ error: { code: "PRODUCT_UNAVAILABLE", message: "niet leverbaar" } })) as typeof fetch;
  try {
    const client = new PicnicClient("token");
    await assert.rejects(() => client.addProduct("abc"), PicnicApiError);
  } finally {
    global.fetch = original;
  }
});

test("PicnicClient: falende fetch wordt een PicnicNetworkError, niet een onbeheerde crash", async () => {
  const original = global.fetch;
  global.fetch = (async () => {
    throw new Error("connect ECONNREFUSED");
  }) as typeof fetch;
  try {
    const client = new PicnicClient("token");
    await assert.rejects(() => client.getUser(), PicnicNetworkError);
  } finally {
    global.fetch = original;
  }
});

test("PicnicClient: een eenmalige verbindingshapering wordt stil met één nieuwe poging opgelost", async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = (async () => {
    calls += 1;
    if (calls === 1) throw new Error("connect ECONNRESET");
    return jsonResponse({ user_id: "1" });
  }) as typeof fetch;
  try {
    const client = new PicnicClient("token");
    const data = (await client.getUser()) as { user_id: string };
    assert.equal(data.user_id, "1");
    assert.equal(calls, 2, "moet na de eerste mislukte poging nog één keer opnieuw proberen");
  } finally {
    global.fetch = original;
  }
});

test("PicnicClient: geldige respons zonder foutcode geeft gewoon de data terug", async () => {
  const original = global.fetch;
  global.fetch = (async () => jsonResponse({ user_id: "1" })) as typeof fetch;
  try {
    const client = new PicnicClient("token");
    const data = (await client.getUser()) as { user_id: string };
    assert.equal(data.user_id, "1");
  } finally {
    global.fetch = original;
  }
});

test("PicnicClient.getDeliverySlots: leest delivery_slots rechtstreeks uit de /cart-respons", async () => {
  const original = global.fetch;
  const requestedPaths: string[] = [];
  global.fetch = (async (input: RequestInfo | URL) => {
    requestedPaths.push(String(input));
    return jsonResponse({ delivery_slots: [{ slot_id: "abc" }] });
  }) as typeof fetch;
  try {
    const client = new PicnicClient("token");
    const data = await client.getDeliverySlots();
    assert.deepEqual(data, [{ slot_id: "abc" }]);
    assert.equal(requestedPaths.length, 1, "geen extra aanroep nodig als /cart de slots al bevat");
    assert.match(requestedPaths[0], /\/cart$/);
  } finally {
    global.fetch = original;
  }
});

test("PicnicClient.getDeliverySlots: valt terug op /cart/delivery_slots als /cart geen delivery_slots-veld heeft", async () => {
  const original = global.fetch;
  const requestedPaths: string[] = [];
  global.fetch = (async (input: RequestInfo | URL) => {
    const path = String(input);
    requestedPaths.push(path);
    if (path.endsWith("/cart")) return jsonResponse({ items: [] });
    return jsonResponse([{ slot_id: "fallback" }]);
  }) as typeof fetch;
  try {
    const client = new PicnicClient("token");
    const data = await client.getDeliverySlots();
    assert.deepEqual(data, [{ slot_id: "fallback" }]);
    assert.equal(requestedPaths.length, 2);
    assert.match(requestedPaths[1], /\/cart\/delivery_slots$/);
  } finally {
    global.fetch = original;
  }
});

test("PicnicClient.getDeliverySlots: AUTH_ERROR wordt een PicnicAuthError", async () => {
  const original = global.fetch;
  global.fetch = (async () =>
    jsonResponse({ error: { code: "AUTH_ERROR", message: "niet ingelogd" } })) as typeof fetch;
  try {
    const client = new PicnicClient("token");
    await assert.rejects(() => client.getDeliverySlots(), PicnicAuthError);
  } finally {
    global.fetch = original;
  }
});

test("PicnicClient.getDeliverySlots: netwerkfout wordt een PicnicNetworkError", async () => {
  const original = global.fetch;
  global.fetch = (async () => {
    throw new Error("connect ECONNREFUSED");
  }) as typeof fetch;
  try {
    const client = new PicnicClient("token");
    await assert.rejects(() => client.getDeliverySlots(), PicnicNetworkError);
  } finally {
    global.fetch = original;
  }
});
