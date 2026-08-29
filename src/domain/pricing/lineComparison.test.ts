import { test } from "node:test";
import assert from "node:assert/strict";
import { compareLineAcrossStores, describeUncomparableStore, showsPromotion } from "./lineComparison";
import type { BasketLineResult, BasketLineStoreResult } from "./basketComparison";

function store(overrides: Partial<BasketLineStoreResult> = {}): BasketLineStoreResult {
  return {
    provider: "AH",
    productId: "ah-1",
    name: "AH Halfvolle melk",
    brand: "AH",
    packageSize: "1 l",
    productUrl: "https://www.ah.nl/producten/product/wi123",
    unitPrice: 0.00129,
    unitPriceUnit: "ML",
    packageQuantity: 1000,
    packagesToBuy: 3,
    cost: 3.87,
    packagePrice: 1.29,
    surplus: null,
    level: "GELIJKWAARDIG",
    levelReason: "zelfde soort product",
    promoLabel: null,
    promoUntil: null,
    wasPrice: null,
    promotionCounts: false,
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
    referenceBrand: "Campina",
    referencePackageSize: "1 l",
    referenceUnitPrice: 0.00145,
    referenceUnitPriceUnit: "ML",
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

test("de cel draagt de productinformatie mee waarmee je zelf kunt nakijken wat het is", () => {
  const cells = compareLineAcrossStores(line({ stores: new Map([["AH", store()]]) }), ["AH"]);
  const picnic = cells.find((cell) => cell.provider === "PICNIC")!;
  const ah = cells.find((cell) => cell.provider === "AH")!;

  assert.equal(picnic.brand, "Campina");
  assert.equal(picnic.packageSize, "1 l");
  assert.equal(picnic.unitPriceLabel, "€ 1,45 per liter");
  // Picnic heeft geen publieke productpagina; een gokje zou op een 404 uitkomen.
  assert.equal(picnic.productUrl, null);

  assert.equal(ah.brand, "AH");
  assert.equal(ah.productUrl, "https://www.ah.nl/producten/product/wi123");
  assert.equal(ah.unitPriceLabel, "€ 1,29 per liter", "hier zie je pas dat AH goedkoper is per liter");
});

test("zonder bekende eenheidsprijs blijft het label leeg in plaats van nul", () => {
  const cells = compareLineAcrossStores(
    line({ stores: new Map([["AH", store({ unitPrice: null, unitPriceUnit: null })]]) }),
    ["AH"]
  );
  assert.equal(cells.find((cell) => cell.provider === "AH")!.unitPriceLabel, null);
});

test("een actie is zichtbaar, maar een nep-korting krijgt geen markering", () => {
  const echt = compareLineAcrossStores(
    line({ stores: new Map([["AH", store({ promoLabel: "1+1 gratis", promotionCounts: true })]]) }),
    ["AH"]
  ).find((cell) => cell.provider === "AH")!;
  assert.equal(showsPromotion(echt), true);

  // Een actie die bij dit aantal niets oplevert is in de doorrekening al op
  // `promotionCounts: false` gezet; de markering volgt dat, en bedenkt geen
  // eigen tweede versie van die regel.
  const zonderVoordeel = compareLineAcrossStores(
    line({ stores: new Map([["AH", store({ promoLabel: "1+1 gratis", promotionCounts: false })]]) }),
    ["AH"]
  ).find((cell) => cell.provider === "AH")!;
  assert.equal(showsPromotion(zonderVoordeel), false);

  const nep = compareLineAcrossStores(
    line({ stores: new Map([["AH", store({ promoLabel: "van 4,99 voor 3,87", fakeDiscount: true, promotionCounts: false })]]) }),
    ["AH"]
  ).find((cell) => cell.provider === "AH")!;
  // De van-prijs is de afgelopen weken niet gerekend: dan is dit de normale
  // prijs, en een groene "Actie" zou een reclame zijn in plaats van hulp.
  assert.equal(showsPromotion(nep), false);

  const zonder = compareLineAcrossStores(line({ stores: new Map([["AH", store()]]) }), ["AH"]).find(
    (cell) => cell.provider === "AH"
  )!;
  assert.equal(showsPromotion(zonder), false);
});

test("twee eenheidsprijzen in verschillende eenheden staan niet naast elkaar in de smalle cel", () => {
  // Bij een ingrediënt in stuks kan onze eigen kolom "per stuk" tonen terwijl
  // Albert Heijn "per kilo" meegeeft. Twee getallen naast elkaar die je niet
  // mag vergelijken, met één woordje verschil — dan liever geen van beide.
  const cells = compareLineAcrossStores(
    line({
      referenceUnitPrice: 2.29,
      referenceUnitPriceUnit: "PIECE",
      stores: new Map([["AH", store({ unitPrice: 0.004, unitPriceUnit: "GRAM" })]]),
    }),
    ["AH"]
  );
  assert.deepEqual(
    cells.map((cell) => cell.unitPriceLabel),
    [null, null]
  );

  // Zelfde eenheid: dan blijven ze gewoon staan, want dán is het wél een
  // vergelijking.
  const gelijk = compareLineAcrossStores(line({ stores: new Map([["AH", store()]]) }), ["AH"]);
  assert.deepEqual(
    gelijk.map((cell) => cell.unitPriceLabel),
    ["€ 1,45 per liter", "€ 1,29 per liter"]
  );
});

/**
 * Gebruikersvraag: "Sommige staat wel de juiste link, maar nog niet de prijs
 * ed. Hoe zit dit?"
 *
 * De streep is het regeltotaal, niet de prijs van het product: kan de app niet
 * uitrekenen hoevéél verpakkingen er nodig zijn, dan valt er geen bedrag voor
 * die regel te noemen. Maar wat één verpakking kost weten we wél, en dat
 * verzwijgen is alleen maar karig.
 */
test("naast elkaar: zonder regeltotaal komt de prijs per verpakking wél mee", () => {
  const cells = compareLineAcrossStores(
    line({
      stores: new Map([
        [
          "AH",
          store({
            // Onbekende verpakkingsinhoud: geen regeltotaal, wel een prijs.
            cost: null,
            packagesToBuy: null,
            packagePrice: 2.59,
            missingReason: "verpakkingsgrootte onbekend",
          }),
        ],
      ]),
    }),
    ["AH"]
  );

  const ah = cells.find((cell) => cell.provider === "AH")!;
  assert.equal(ah.cost, null, "het regeltotaal blijft onbekend, en dat hoort ook");
  assert.equal(ah.packagePrice, 2.59, "maar de prijs per verpakking komt mee");
  assert.equal(ah.note, "verpakkingsgrootte onbekend");
});

test("naast elkaar: een winkel zonder product heeft ook geen prijs per verpakking", () => {
  // Geen product gevonden is iets anders dan een product zonder maat — daar
  // valt niets te melden, ook geen prijs.
  const cells = compareLineAcrossStores(line({ stores: new Map() }), ["DIRK"]);
  const dirk = cells.find((cell) => cell.provider === "DIRK")!;
  assert.equal(dirk.packagePrice, null);
  assert.equal(dirk.note, "niet gevonden");
});
