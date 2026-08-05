import { test } from "node:test";
import assert from "node:assert/strict";
import { timeOfDayGreeting, isDayStartedOrPast } from "./week";

// Januari gekozen i.p.v. een zomermaand om DST-onzekerheid te vermijden:
// Europe/Amsterdam staat dan vast op UTC+1.

test("timeOfDayGreeting: ochtend, middag en avond", () => {
  assert.equal(timeOfDayGreeting(new Date("2026-01-15T07:00:00Z")), "Goedemorgen"); // 08:00 lokaal
  assert.equal(timeOfDayGreeting(new Date("2026-01-15T13:00:00Z")), "Goedemiddag"); // 14:00 lokaal
  assert.equal(timeOfDayGreeting(new Date("2026-01-15T19:00:00Z")), "Goedenavond"); // 20:00 lokaal
});

test("timeOfDayGreeting: grenswaarden (12:00 en 18:00 lokaal)", () => {
  assert.equal(timeOfDayGreeting(new Date("2026-01-15T11:00:00Z")), "Goedemiddag"); // 12:00 lokaal
  assert.equal(timeOfDayGreeting(new Date("2026-01-15T17:00:00Z")), "Goedenavond"); // 18:00 lokaal
  assert.equal(timeOfDayGreeting(new Date("2026-01-15T10:59:00Z")), "Goedemorgen"); // 11:59 lokaal
});

test("isDayStartedOrPast: vandaag telt als begonnen, ongeacht het tijdstip", () => {
  const vanochtend = new Date("2026-01-15T00:30:00Z");
  const vanavond = new Date("2026-01-15T22:00:00Z");
  assert.equal(isDayStartedOrPast(vanochtend, vanavond), true);
});

test("isDayStartedOrPast: een dag in het verleden is begonnen", () => {
  const gisteren = new Date("2026-01-14T00:00:00Z");
  const nu = new Date("2026-01-15T12:00:00Z");
  assert.equal(isDayStartedOrPast(gisteren, nu), true);
});

test("isDayStartedOrPast: een dag verderop deze week is nog niet begonnen — precies het WP-scenario (feedback vragen over een nog te eten maaltijd)", () => {
  const donderdag = new Date("2026-01-15T00:00:00Z");
  const maandagOchtend = new Date("2026-01-12T08:00:00Z");
  assert.equal(isDayStartedOrPast(donderdag, maandagOchtend), false);
});
