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
