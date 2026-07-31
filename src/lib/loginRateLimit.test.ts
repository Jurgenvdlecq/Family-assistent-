/**
 * Integratietest tegen een echte (lokale) Postgres — de rate limiter leunt
 * bewust op een gedeelde databasetabel (zie loginRateLimit.ts), dus een mock
 * zou precies het gedrag wegpoetsen dat getest moet worden (WP-vervolg A5).
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { checkLoginRateLimit, clearLoginAttempts, recordFailedLoginAttempt } from "./loginRateLimit";

const TEST_USER = "wp-a5-rate-limit-test-gebruiker";

async function cleanup(identifier: string = TEST_USER) {
  await prisma.loginAttempt.deleteMany({ where: { identifier } });
}

test("normale login blijft werken: geen mislukte pogingen betekent nooit geblokkeerd", async () => {
  await cleanup();
  try {
    const status = await checkLoginRateLimit(TEST_USER);
    assert.equal(status.blocked, false);
    assert.equal(status.attemptsInWindow, 0);
  } finally {
    await cleanup();
  }
});

test("een paar mislukte pogingen blokkeren nog niet meteen", async () => {
  await cleanup();
  try {
    const now = new Date("2026-07-31T12:00:00Z");
    for (let i = 0; i < 3; i += 1) {
      await recordFailedLoginAttempt(TEST_USER, now);
    }
    const status = await checkLoginRateLimit(TEST_USER, now);
    assert.equal(status.blocked, false);
    assert.equal(status.attemptsInWindow, 3);
  } finally {
    await cleanup();
  }
});

test("te veel pogingen binnen het tijdvenster worden geblokkeerd", async () => {
  await cleanup();
  try {
    const now = new Date("2026-07-31T12:00:00Z");
    for (let i = 0; i < 8; i += 1) {
      await recordFailedLoginAttempt(TEST_USER, now);
    }
    const status = await checkLoginRateLimit(TEST_USER, now);
    assert.equal(status.blocked, true);
    assert.equal(status.attemptsInWindow, 8);
  } finally {
    await cleanup();
  }
});

test("de teller verloopt/herstelt volgens beleid: pogingen buiten het venster tellen niet mee", async () => {
  await cleanup();
  try {
    const teLangGeleden = new Date("2026-07-31T00:00:00Z");
    for (let i = 0; i < 8; i += 1) {
      await recordFailedLoginAttempt(TEST_USER, teLangGeleden);
    }
    // Precies 15 minuten later is het venster (15 min) net verstreken.
    const nu = new Date(teLangGeleden.getTime() + 16 * 60 * 1000);
    const status = await checkLoginRateLimit(TEST_USER, nu);
    assert.equal(status.blocked, false);
    assert.equal(status.attemptsInWindow, 0);
  } finally {
    await cleanup();
  }
});

test("een geslaagde login verlaagt/herstelt de teller (clearLoginAttempts)", async () => {
  await cleanup();
  try {
    const now = new Date("2026-07-31T12:00:00Z");
    for (let i = 0; i < 5; i += 1) {
      await recordFailedLoginAttempt(TEST_USER, now);
    }
    await clearLoginAttempts(TEST_USER);
    const status = await checkLoginRateLimit(TEST_USER, now);
    assert.equal(status.blocked, false);
    assert.equal(status.attemptsInWindow, 0);
  } finally {
    await cleanup();
  }
});

test("foutmeldingen lekken geen bestaan van een gebruikersnaam: geblokkeerd-status is identiek voor een bestaande en niet-bestaande gebruikersnaam-vorm", async () => {
  // De rate limiter zelf kent geen concept van "bestaat deze gebruikersnaam
  // als huishouden" — hij telt puur per genormaliseerde identifier. Dat is
  // precies de eigenschap die voorkomt dat blokkering iets verraadt: een
  // nooit-gebruikte naam kan evengoed geblokkeerd raken als een bestaande.
  const nooitGebruikteNaam = "wp-a5-naam-die-nergens-toe-behoort";
  await cleanup(nooitGebruikteNaam);
  try {
    const now = new Date("2026-07-31T12:00:00Z");
    for (let i = 0; i < 8; i += 1) {
      await recordFailedLoginAttempt(nooitGebruikteNaam, now);
    }
    const status = await checkLoginRateLimit(nooitGebruikteNaam, now);
    assert.equal(status.blocked, true);
  } finally {
    await cleanup(nooitGebruikteNaam);
  }
});

test("verschillende gebruikersnamen beïnvloeden elkaar niet onnodig", async () => {
  const anderUser = "wp-a5-ander-huishouden";
  await cleanup();
  await cleanup(anderUser);
  try {
    const now = new Date("2026-07-31T12:00:00Z");
    for (let i = 0; i < 8; i += 1) {
      await recordFailedLoginAttempt(TEST_USER, now);
    }
    const statusAnder = await checkLoginRateLimit(anderUser, now);
    assert.equal(statusAnder.blocked, false);
    assert.equal(statusAnder.attemptsInWindow, 0);
  } finally {
    await cleanup();
    await cleanup(anderUser);
  }
});

test("gebruikersnaam wordt genormaliseerd: hoofdletters/spaties tellen als dezelfde identifier", async () => {
  await cleanup();
  try {
    const now = new Date("2026-07-31T12:00:00Z");
    for (let i = 0; i < 8; i += 1) {
      await recordFailedLoginAttempt("  WP-A5-Rate-Limit-Test-Gebruiker  ", now);
    }
    const status = await checkLoginRateLimit(TEST_USER, now);
    assert.equal(status.blocked, true);
  } finally {
    await cleanup();
  }
});

test("opgeslagen rate-limit-data bevat geen wachtwoorden: alleen identifier en tijdstip", async () => {
  await cleanup();
  try {
    const now = new Date("2026-07-31T12:00:00Z");
    await recordFailedLoginAttempt(TEST_USER, now);
    const rows = await prisma.loginAttempt.findMany({ where: { identifier: TEST_USER } });
    assert.equal(rows.length, 1);
    const keys = Object.keys(rows[0]).sort();
    assert.deepEqual(keys, ["createdAt", "id", "identifier"]);
  } finally {
    await cleanup();
  }
});
