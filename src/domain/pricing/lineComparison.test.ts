import { test } from "node:test";
import assert from "node:assert/strict";
import { compareLineAcrossStores, describeUncomparableStore } from "./lineComparison";
import type { BasketLineResult, BasketLineStoreResult } from "./basketComparison";

function store(overrides: Partial<BasketLineStoreResult> = {}): BasketLineStoreResult {
  return {
    provider: "AH",
    productId: "ah-1",
    name: "AH Halfvolle melk",
    packageSize: "1 l",
    packageQuantity: 1000,
    packagesToBuy: 3,
    cost: 3.87,
    surplus: null,
    level: "GELIJKWAARDIG",
    levelReason: "zelfde soort product",
    promoLabel: null,
    promoExplanation: null,
    costWithoutPromo: 3.87,
    fakeDiscount: false,
    observedAt: new Date("2026-08-28T05:00:00Z"),
    stale: false,
    missingReason: null,
    ...overrides,
  };
}

function line(overrides: Partial<BasketLineResult> = {}): BasketLineResult {
  return {
    lineId: "regel-melk",
    ingredientName: "Halfvolle melk",
    neededQuantity: 3000,
    unit: "ML",
    referencePrice: 1.45,
    referenceName: "Campina halfvolle melk",
    referenceCost: 4.35,
    referencePackages: 3,
    stores: new Map(),
    ...overrides,
  };
}

test("naast elkaar: Picnic staat vooraan, daarna de winkels in vaste volgorde", () => {
  const cells = compareLineAcrossStores(
    line({
      stores: new Map([
        ["AH", store()],
        ["DIRK", store({ provider: "DIRK", productId: "dirk-1", cost: 5.7, packagesToBuy: 6 })],
      ]),
    }),
    ["AH", "DIRK"]
  );

  assert.deepEqual(
    cells.map((cell) => cell.provider),
    ["PICNIC", "AH", "DIRK"]
  );
  assert.deepEqual(
    cells.map((cell) => cell.cost),
    [4.35, 3.87, 5.7]
  );
});

test("naast elkaar: de goedkoopste vergelijkbare cel wordt gemarkeerd", () => {
  const cells = compareLineAcrossStores(
    line({
      stores: new Map([
        ["AH", store()],
        ["DIRK", store({ provider: "DIRK", productId: "dirk-1", cost: 5.7 })],
      ]),
    }),
    ["AH", "DIRK"]
  );
  assert.deepEqual(
    cells.filter((cell) => cell.cheapest).map((cell) => cell.provider),
    ["AH"]
  );
});

test("naast elkaar: een alternatief wordt nooit gekroond, ook niet als het het laagste bedrag is", () => {
  // De kern van het equivalentiemodel: goedkoper door iets anders te kopen is
  // geen besparing.
  const cells = compareLineAcrossStores(
    line({
      stores: new Map([
        ["AH", store({ cost: 2.55, level: "ALTERNATIEF", name: "AH Houdbare halfvolle melk" })],
        ["DIRK", store({ provider: "DIRK", productId: "dirk-1", cost: 5.7 })],
      ]),
    }),
    ["AH", "DIRK"]
  );

  const ah = cells.find((cell) => cell.provider === "AH")!;
  assert.equal(ah.cheapest, false, "het laagste bedrag, maar een ander product");
  assert.equal(ah.note, "ander soort");
  // Van de wél vergelijkbare cellen is Picnic (€ 4,35) goedkoper dan Dirk
  // (€ 5,70) — het alternatief van € 2,55 doet niet mee.
  assert.deepEqual(
    cells.filter((cell) => cell.cheapest).map((cell) => cell.provider),
    ["PICNIC"]
  );
});

test("naast elkaar: een winkel zonder product krijgt geen nul maar 'niet gevonden'", () => {
  const cells = compareLineAcrossStores(line({ stores: new Map([["AH", store()]]) }), ["AH", "DIRK"]);
  const dirk = cells.find((cell) => cell.provider === "DIRK")!;
  assert.equal(dirk.cost, null);
  assert.equal(dirk.note, "niet gevonden");
  assert.equal(dirk.cheapest, false);
});

test("naast elkaar: met maar één bekend bedrag wordt er niets gekroond", () => {
  // "Het goedkoopst" met één deelnemer is geen vergelijking.
  const cells = compareLineAcrossStores(line({ stores: new Map() }), ["AH", "DIRK"]);
  assert.equal(cells.filter((cell) => cell.cheapest).length, 0);
  assert.equal(cells[0].cost, 4.35, "de Picnic-prijs staat er wel gewoon");
});

test("naast elkaar: zonder eigen productkeuze zegt de Picnic-cel dat, en telt hij niet mee", () => {
  const cells = compareLineAcrossStores(
    line({
      referenceName: null,
      referenceCost: null,
      referencePackages: null,
      stores: new Map([
        ["AH", store()],
        ["DIRK", store({ provider: "DIRK", productId: "dirk-1", cost: 5.7 })],
      ]),
    }),
    ["AH", "DIRK"]
  );
  assert.equal(cells[0].note, "nog geen product gekozen");
  assert.equal(cells[0].cheapest, false);
  // De winkels onderling blijven wél vergelijkbaar.
  assert.equal(cells.find((cell) => cell.provider === "AH")!.cheapest, true);
});

test("naast elkaar: twee even goedkope winkels worden allebei gemarkeerd", () => {
  const cells = compareLineAcrossStores(
    line({
      referenceCost: 9,
      stores: new Map([
        ["AH", store({ cost: 3.87 })],
        ["DIRK", store({ provider: "DIRK", productId: "dirk-1", cost: 3.87 })],
      ]),
    }),
    ["AH", "DIRK"]
  );
  assert.deepEqual(
    cells.filter((cell) => cell.cheapest).map((cell) => cell.provider),
    ["AH", "DIRK"]
  );
});

test("toelichting: een winkel die gewoon meetelt krijgt geen melding", () => {
  const uitleg = describeUncomparableStore([line({ stores: new Map([["AH", store()]]) })], "AH", "Albert Heijn");
  assert.equal(uitleg, null);
});

test("toelichting: zonder enige prijs is het 'nog geen prijzen', niet € 0", () => {
  const uitleg = describeUncomparableStore([line({ stores: new Map() })], "AH", "Albert Heijn");
  assert.match(uitleg!, /nog geen prijzen/);
  assert.match(uitleg!, /geen € 0/);
});

test("toelichting: met alleen alternatieven zegt hij dat, en niet 'geen prijzen'", () => {
  // De oude tekst beweerde "geen prijzen" terwijl er drie regels lager een
  // bedrag stond. Dat is precies de tegenstrijdigheid die dit moet vermijden.
  const uitleg = describeUncomparableStore(
    [line({ stores: new Map([["AH", store({ level: "ALTERNATIEF" })]]) })],
    "AH",
    "Albert Heijn"
  );
  assert.match(uitleg!, /wel prijzen/);
  assert.match(uitleg!, /ander soort product/);
});

test("toelichting: een harde match zonder eigen prijs wordt niet 'geen gelijkwaardig product' genoemd", () => {
  // Hier stond "geen enkel product dat hetzelfde of gelijkwaardig is" terwijl
  // de regel eronder de badge "gelijkwaardig" droeg — letterlijk het
  // omgekeerde van wat er stond.
  const uitleg = describeUncomparableStore(
    [line({ stores: new Map([["AH", store({ missingReason: "onze eigen prijs is onbekend" })]]) })],
    "AH",
    "Albert Heijn"
  );
  assert.match(uitleg!, /wel prijzen/);
  assert.match(uitleg!, /[Oo]nze eigen prijs/);
  assert.doesNotMatch(uitleg!, /ander soort/);
});
