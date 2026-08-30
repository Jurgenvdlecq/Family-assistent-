import { test } from "node:test";
import assert from "node:assert/strict";
import { shareOfRemainingTime } from "./timeBudget";

/**
 * Gebruikersmelding uit het statusblok: "Dirk: 37 producten bijgewerkt, maar
 * niet alles lukte — gestopt bij het tijdslimiet." Albert Heijn meldde in
 * diezelfde ronde géén tijdslimiet: die is een API en was ruim op tijd klaar.
 *
 * De tijd werd vast in tweeën gedeeld, dus de seconden die Albert Heijn
 * overhield stonden stil terwijl Dirk ze hard nodig had.
 */
test("tijdsbudget: wat de eerste winkel overhoudt gaat naar de volgende", () => {
  const start = 1_000_000;
  const eindpunt = start + 48_000;

  // Twee winkels, niets verstreken: de eerste krijgt de helft.
  assert.equal(shareOfRemainingTime(eindpunt, 2, start), start + 24_000);

  // Albert Heijn was na 10 seconden klaar. Dirk is de laatste en krijgt
  // daarmee alles wat er nog is — 38 seconden in plaats van 24.
  assert.equal(shareOfRemainingTime(eindpunt, 1, start + 10_000), eindpunt);
});

test("tijdsbudget: de laatste winkel kan er nooit overheen", () => {
  const start = 1_000_000;
  const eindpunt = start + 48_000;

  // Ook als de eerste winkel haar deel volledig opmaakte, of er zelfs
  // overheen ging: het eindpunt ligt vast en schuift niet op.
  assert.equal(shareOfRemainingTime(eindpunt, 1, start + 47_000), eindpunt);
  assert.equal(shareOfRemainingTime(eindpunt, 1, start + 60_000), eindpunt);
});

test("tijdsbudget: al verstreken tijd levert geen negatief deel op", () => {
  const start = 1_000_000;
  const eindpunt = start + 48_000;
  // Drie winkels, maar de tijd is al op: geen enkele winkel krijgt nog ruimte,
  // en zeker geen deadline in het verleden die alles meteen laat afbreken op
  // een onduidelijke manier.
  const deadline = shareOfRemainingTime(eindpunt, 3, start + 50_000);
  assert.equal(deadline, start + 50_000, "nu, dus meteen stoppen — niet eerder dan nu");
});
