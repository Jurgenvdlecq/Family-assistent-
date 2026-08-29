import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPromotion, parsePromoMechanism, promotionIsActive } from "./promotions";

test("actie: 1+1 gratis is geen 50% korting", () => {
  // Bij drie stuks betaal je er twee — 33%, niet 50%. Precies het soort
  // verschil waardoor een bedrag op het scherm niet klopt met de kassabon.
  const mechanism = parsePromoMechanism("1+1 gratis");
  assert.deepEqual(mechanism, { kind: "X_PLUS_Y_GRATIS", paid: 1, free: 1 });

  assert.equal(applyPromotion(3, 2, mechanism).cost, 4);
  assert.equal(applyPromotion(2, 2, mechanism).cost, 2);
  assert.equal(applyPromotion(4, 2, mechanism).cost, 4);
});

test("actie: bij één stuk levert 1+1 gratis niets op, en dat wordt gezegd", () => {
  // Doen alsof je korting krijgt op één stuk is precies de misleiding die
  // deze laag moet voorkomen.
  const outcome = applyPromotion(1, 2, parsePromoMechanism("1+1 gratis"));
  assert.equal(outcome.cost, 2);
  assert.equal(outcome.costWithoutPromo, 2);
  assert.match(outcome.explanation!, /vanaf 2 stuks/);
});

test("actie: 2e halve prijs geldt per paar", () => {
  const mechanism = parsePromoMechanism("2e halve prijs");
  assert.equal(applyPromotion(2, 2, mechanism).cost, 3, "1 vol + 1 half");
  assert.equal(applyPromotion(3, 2, mechanism).cost, 5, "één paar plus één losse");
  assert.equal(applyPromotion(4, 2, mechanism).cost, 6);
});

test("actie: 3 voor 2 telt per groep, met de rest gewoon vol", () => {
  const mechanism = parsePromoMechanism("3 voor 2");
  assert.deepEqual(mechanism, { kind: "X_VOOR_Y", groupSize: 3, paidCount: 2 });
  assert.equal(applyPromotion(3, 1.5, mechanism).cost, 3);
  assert.equal(applyPromotion(4, 1.5, mechanism).cost, 4.5, "3 voor 2, plus één losse");
});

test("actie: '2 voor € 3,00' is een vaste groepsprijs, geen aantal", () => {
  // Zonder deze volgorde in het lezen zou "3.00" als aantal gelezen worden.
  const mechanism = parsePromoMechanism("2 voor € 3,00");
  assert.deepEqual(mechanism, { kind: "X_VOOR_BEDRAG", groupSize: 2, groupPrice: 3 });
  assert.equal(applyPromotion(2, 1.99, mechanism).cost, 3);
  assert.equal(applyPromotion(3, 1.99, mechanism).cost, 4.99, "één groep plus één losse");
});

test("actie: een percentage geldt gewoon per stuk", () => {
  assert.equal(applyPromotion(2, 2, parsePromoMechanism("25% korting")).cost, 3);
});

test("actie: een label dat we niet zeker herkennen wordt niet toegepast", () => {
  // De kernregel. Een verzonnen korting maakt het bedrag fout; een gemiste
  // korting maakt het alleen voorzichtig.
  assert.equal(parsePromoMechanism("Nu extra voordelig"), null);
  assert.equal(parsePromoMechanism("Weekendkorting"), null);
  assert.equal(parsePromoMechanism(null), null);

  const outcome = applyPromotion(3, 2, parsePromoMechanism("Nu extra voordelig"));
  assert.equal(outcome.cost, 6, "gewoon aantal maal prijs");
  assert.equal(outcome.explanation, null);
});

test("actie: een verlopen actie telt niet mee", () => {
  const now = new Date("2026-08-29T12:00:00Z");
  assert.equal(promotionIsActive(new Date("2026-08-28T12:00:00Z"), now), false);
  assert.equal(promotionIsActive(new Date("2026-08-30T12:00:00Z"), now), true);
  // Geen einddatum betekent onbekend, niet verlopen: niet elke winkel geeft er een.
  assert.equal(promotionIsActive(null, now), true);
});
