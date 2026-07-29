/**
 * Integratietest tegen een echte (lokale) Postgres — alleen de externe
 * Picnic-HTTP-aanroep wordt vervangen door een fake fetch (Fase 7/8: er is
 * geen testomgeving voor de niet-officiële Picnic-API, zie ook
 * cartService.test.ts en client.test.ts voor hetzelfde patroon). Dit is de
 * kernlogica achter "Picnic koppelen" op /ons-gezin (WP63) — de "use
 * server"-actie eromheen kan niet los getest worden omdat die
 * cookies()/redirect() nodig heeft (een echte Next.js-requestcontext).
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../prisma";
import {
  connectPicnicAccountForHousehold,
  verifyPicnicTwoFactorCodeForHousehold,
} from "./accountConnection";

type FakeLoginBehavior = "success" | "wrong-credentials" | "network-error" | "two-factor-required";

function fakeLoginFetch(behavior: FakeLoginBehavior) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/user/login")) {
      if (behavior === "network-error") throw new Error("connect ECONNREFUSED");
      if (behavior === "wrong-credentials") {
        return new Response(JSON.stringify({ error: { code: "AUTH_ERROR", message: "niet ingelogd" } }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (behavior === "two-factor-required") {
        return new Response(JSON.stringify({ second_factor_authentication_required: true }), {
          headers: { "Content-Type": "application/json", "x-picnic-auth": "partial-token" },
        });
      }
      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json", "x-picnic-auth": "final-token" },
      });
    }
    if (url.includes("/user/2fa/generate")) {
      return new Response(null, { status: 204, headers: { "x-picnic-auth": "partial-token" } });
    }
    return new Response(JSON.stringify({ error: { code: "UNKNOWN", message: "onverwacht endpoint" } }), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

function fakeVerifyFetch(behavior: "success" | "wrong-code") {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/user/2fa/verify")) {
      if (behavior === "wrong-code") {
        return new Response(JSON.stringify({ error: { code: "OTP_INVALID", message: "code klopt niet" } }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 204, headers: { "x-picnic-auth": "final-token" } });
    }
    return new Response(JSON.stringify({ error: { code: "UNKNOWN", message: "onverwacht endpoint" } }), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

async function makeHousehold(name: string) {
  return prisma.household.create({
    data: { name, persons: { create: [{ name: "Test", role: "PARENT" }] } },
  });
}

async function cleanup(householdId: string) {
  await prisma.household.delete({ where: { id: householdId } });
}

test("connectPicnicAccountForHousehold: gelukte koppeling zonder 2FA slaat het token op", async () => {
  const household = await makeHousehold("WP63 test — gelukt");
  const originalFetch = global.fetch;
  global.fetch = fakeLoginFetch("success");
  try {
    const outcome = await connectPicnicAccountForHousehold(household.id, "test@voorbeeld.nl", "geheim123");
    assert.equal(outcome, "connected");
    const updated = await prisma.household.findUniqueOrThrow({ where: { id: household.id } });
    assert.equal(updated.picnicAuthToken, "final-token");
    assert.equal(updated.picnicPendingAuthToken, null);
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});

test("connectPicnicAccountForHousehold: verkeerde combinatie slaat geen token op", async () => {
  const household = await makeHousehold("WP63 test — verkeerd wachtwoord");
  const originalFetch = global.fetch;
  global.fetch = fakeLoginFetch("wrong-credentials");
  try {
    const outcome = await connectPicnicAccountForHousehold(household.id, "test@voorbeeld.nl", "foutief");
    assert.equal(outcome, "wrongCredentials");
    const updated = await prisma.household.findUniqueOrThrow({ where: { id: household.id } });
    assert.equal(updated.picnicAuthToken, null);
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});

test("connectPicnicAccountForHousehold: netwerkfout geeft een duidelijke, aparte uitkomst", async () => {
  const household = await makeHousehold("WP63 test — netwerkfout");
  const originalFetch = global.fetch;
  global.fetch = fakeLoginFetch("network-error");
  try {
    const outcome = await connectPicnicAccountForHousehold(household.id, "test@voorbeeld.nl", "geheim123");
    assert.equal(outcome, "networkError");
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});

test("connectPicnicAccountForHousehold: lege velden worden niet als een echte poging behandeld", async () => {
  const household = await makeHousehold("WP63 test — lege velden");
  try {
    const outcome = await connectPicnicAccountForHousehold(household.id, "", "");
    assert.equal(outcome, "missingFields");
  } finally {
    await cleanup(household.id);
  }
});

test("connectPicnicAccountForHousehold + verifyPicnicTwoFactorCodeForHousehold: volledige 2FA-flow", async () => {
  const household = await makeHousehold("WP63 test — 2FA");
  const originalFetch = global.fetch;
  try {
    global.fetch = fakeLoginFetch("two-factor-required");
    const loginOutcome = await connectPicnicAccountForHousehold(household.id, "test@voorbeeld.nl", "geheim123");
    assert.equal(loginOutcome, "twoFactorNeeded");

    const afterLogin = await prisma.household.findUniqueOrThrow({ where: { id: household.id } });
    assert.equal(
      afterLogin.picnicPendingAuthToken,
      "partial-token",
      "het gedeeltelijke token moet apart van het echte token bewaard zijn"
    );
    assert.equal(afterLogin.picnicAuthToken, null, "er mag nog geen werkend token staan vóór de 2FA-code");

    global.fetch = fakeVerifyFetch("success");
    const verifyOutcome = await verifyPicnicTwoFactorCodeForHousehold(household.id, "123456");
    assert.equal(verifyOutcome, "connected");

    const afterVerify = await prisma.household.findUniqueOrThrow({ where: { id: household.id } });
    assert.equal(afterVerify.picnicAuthToken, "final-token");
    assert.equal(afterVerify.picnicPendingAuthToken, null, "het tijdelijke token moet opgeruimd zijn");
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});

test("verifyPicnicTwoFactorCodeForHousehold: verkeerde code laat het huishouden ongewijzigd", async () => {
  const household = await makeHousehold("WP63 test — verkeerde 2FA-code");
  const originalFetch = global.fetch;
  try {
    await prisma.household.update({ where: { id: household.id }, data: { picnicPendingAuthToken: "partial-token" } });
    global.fetch = fakeVerifyFetch("wrong-code");
    const outcome = await verifyPicnicTwoFactorCodeForHousehold(household.id, "000000");
    assert.equal(outcome, "twoFactorWrongCode");

    const updated = await prisma.household.findUniqueOrThrow({ where: { id: household.id } });
    assert.equal(updated.picnicAuthToken, null);
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});

test("verifyPicnicTwoFactorCodeForHousehold: zonder lopende poging is de code altijd verlopen", async () => {
  const household = await makeHousehold("WP63 test — geen lopende 2FA-poging");
  try {
    const outcome = await verifyPicnicTwoFactorCodeForHousehold(household.id, "123456");
    assert.equal(outcome, "twoFactorExpired");
  } finally {
    await cleanup(household.id);
  }
});
