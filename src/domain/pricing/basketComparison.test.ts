import { test } from "node:test";
import assert from "node:assert/strict";
import { compareBasket, type BasketLineInput, type StoreCandidateInput } from "./basketComparison";

const OBSERVED = new Date("2026-08-28T05:00:00Z");

function line(overrides: Partial<BasketLineInput> = {}): BasketLineInput {
  return {
    lineId: "regel-melk",
    ingredientId: "melk",
    ingredientName: "Halfvolle melk",
    neededQuantity: 3000,
    unit: "ML",
    reference: {
      name: "Campina verse halfvolle melk",
      brand: "Campina",
      packageSize: "1 l",
      qualityTier: "STANDAARD",
      gtin: null,
      price: 1.45,
      packageQuantity: 1000,
      packageUnit: "ML",
    },
    ...overrides,
  };
}

function candidate(overrides: Partial<StoreCandidateInput> = {}): StoreCandidateInput {
  return {
    provider: "AH",
    productId: "ah-melk",
    name: "AH Verse halfvolle melk",
    brand: "AH",
    packageSize: "1 l",
    qualityTier: "STANDAARD",
    gtin: null,
    price: 1.29,
    packageQuantity: 1000,
    packageUnit: "ML",
    promoLabel: null,
    promoUntil: null,
    wasPrice: null,
    observedAt: OBSERVED,
    stale: false,
    ...overrides,
  };
}

test("het mandje: drie liter melk wordt drie pakken, niet drie liter", () => {
  // Je koopt verpakkingen, geen liters — dat is het hele punt van een
  // mandje-simulatie.
  const comparison = compareBasket([line()], new Map([["regel-melk", [candidate()]]]), ["AH"]);
  const result = comparison.lines[0].stores.get("AH")!;
  assert.equal(result.packagesToBuy, 3);
  assert.equal(result.cost, 3.87);
  assert.equal(result.level, "GELIJKWAARDIG");
});

test("het mandje: halve liters maken het duurder, niet goedkoper", () => {
  // Het voorbeeld uit de opdracht: €1,90 per liter bij Dirk tegenover €1,29
  // bij AH, ook al staat er een lager bedrag op de verpakking.
  const comparison = compareBasket(
    [line()],
    new Map([
      [
        "regel-melk",
        [
          candidate(),
          candidate({
            provider: "DIRK",
            productId: "dirk-melk",
            name: "Melkunie verse halfvolle melk",
            brand: "Melkunie",
            packageSize: "500 ml",
            price: 0.95,
            packageQuantity: 500,
          }),
        ],
      ],
    ]),
    ["AH", "DIRK"]
  );
  assert.equal(comparison.lines[0].stores.get("AH")!.cost, 3.87);
  assert.equal(comparison.lines[0].stores.get("DIRK")!.packagesToBuy, 6);
  assert.equal(comparison.lines[0].stores.get("DIRK")!.cost, 5.7);
});

test("het mandje: een alternatief telt alleen in het tweede bedrag", () => {
  const comparison = compareBasket(
    [line()],
    new Map([
      [
        "regel-melk",
        [candidate({ name: "AH Houdbare halfvolle melk", price: 0.85, productId: "ah-houdbaar" })],
      ],
    ]),
    ["AH"]
  );
  const total = comparison.totals.get("AH")!;
  assert.equal(total.hardTotal, 0, "houdbare melk hoort niet in het harde bedrag");
  assert.equal(total.alternativeTotal, 2.55);
  assert.equal(total.linesWithAlternative, 1);
  assert.equal(total.linesMissing, 1, "voor het harde bedrag ontbreekt deze regel");
});

test("het mandje: liever gelijkwaardig dan goedkoop-maar-anders", () => {
  // "Goedkoper door iets anders te kopen" is geen besparing.
  const comparison = compareBasket(
    [line()],
    new Map([
      [
        "regel-melk",
        [
          candidate({ name: "AH Houdbare halfvolle melk", price: 0.85, productId: "goedkoop" }),
          candidate({ name: "AH Verse halfvolle melk", price: 1.29, productId: "gelijkwaardig" }),
        ],
      ],
    ]),
    ["AH"]
  );
  assert.equal(comparison.lines[0].stores.get("AH")!.productId, "gelijkwaardig");
});

test("het mandje: een winkel die het product niet heeft krijgt geen nul, maar een ontbrekende regel", () => {
  // Zonder dit onderscheid lijkt de winkel met het kleinste assortiment de
  // goedkoopste.
  const comparison = compareBasket([line()], new Map(), ["AH", "DIRK"]);
  const total = comparison.totals.get("DIRK")!;
  assert.equal(total.hardTotal, 0);
  assert.equal(total.linesMissing, 1);
  assert.equal(total.linesCompared, 0);
  assert.equal(comparison.lines[0].stores.has("DIRK"), false);
});

test("het mandje: een onbekende verpakkingsgrootte levert geen bedrag op", () => {
  const comparison = compareBasket(
    [line()],
    new Map([["regel-melk", [candidate({ packageQuantity: null, packageSize: "naar keuze" })]]]),
    ["AH"]
  );
  const result = comparison.lines[0].stores.get("AH")!;
  assert.equal(result.cost, null);
  assert.equal(result.missingReason, "verpakkingsgrootte onbekend");
  assert.equal(comparison.totals.get("AH")!.hardTotal, 0);
});

test("het mandje: het overschot wordt getoond, want dat is geen besparing", () => {
  // 2 liter kopen voor 1,5 liter recept is geen besparing als de rest weg moet.
  const comparison = compareBasket(
    [line({ neededQuantity: 1500 })],
    new Map([["regel-melk", [candidate()]]]),
    ["AH"]
  );
  const result = comparison.lines[0].stores.get("AH")!;
  assert.equal(result.packagesToBuy, 2);
  assert.equal(result.surplus, 500);
});

test("het mandje: zonder eigen productkeuze valt er niets te vergelijken", () => {
  const comparison = compareBasket(
    [line({ reference: null })],
    new Map([["regel-melk", [candidate()]]]),
    ["AH"]
  );
  const result = comparison.lines[0].stores.get("AH")!;
  assert.equal(result.level, "NIET_VERGELIJKBAAR");
  assert.equal(comparison.totals.get("AH")!.linesMissing, 1);
  assert.equal(comparison.referenceLinesMissing, 1);
});

test("het mandje: het eigen totaal gebruikt dezelfde verpakkingsberekening", () => {
  // Anders zouden de kolommen appels met peren vergelijken.
  const comparison = compareBasket([line()], new Map([["regel-melk", [candidate()]]]), ["AH"]);
  assert.equal(comparison.referenceTotal, 4.35, "3 pakken van €1,45");
});

test("het mandje: een winkel wordt niet goedkoper door regels te missen", () => {
  // Het ongelijke-mandjes-probleem. Twee regels van elk drie pakken; de winkel
  // heeft er maar één. Zonder een eigen totaal over dezelfde regels zou €3,87
  // naast €8,70 komen te staan — een "besparing" van meer dan de helft, terwijl
  // er in werkelijkheid één product ontbreekt.
  const comparison = compareBasket(
    [line(), line({ lineId: "regel-2" })],
    new Map([["regel-melk", [candidate()]]]),
    ["AH"]
  );
  const total = comparison.totals.get("AH")!;
  assert.equal(total.hardTotal, 3.87);
  assert.equal(total.referenceTotalForHardLines, 4.35, "alleen de regel die de winkel wél heeft");
  assert.equal(comparison.referenceTotal, 8.7, "het totaal van de hele lijst blijft apart bestaan");
  assert.equal(total.linesMissing, 1);
});

test("het mandje: zonder eigen prijs telt de regel nergens mee", () => {
  // Anders zou de winkelkolom een bedrag krijgen waar aan onze kant niets
  // tegenover staat — dezelfde scheefheid, maar dan in het nadeel van de winkel.
  const comparison = compareBasket(
    [line({ reference: { ...line().reference!, price: null } })],
    new Map([["regel-melk", [candidate()]]]),
    ["AH"]
  );
  const total = comparison.totals.get("AH")!;
  assert.equal(total.hardTotal, 0);
  assert.equal(total.referenceTotalForHardLines, 0);
  assert.equal(total.linesMissing, 1);
  assert.equal(comparison.lines[0].stores.get("AH")!.missingReason, "onze eigen prijs is onbekend");
  assert.equal(comparison.lines[0].stores.get("AH")!.cost, 3.87, "de prijs zelf blijft wel zichtbaar");
});

test("het mandje: ook het alternatieve bedrag krijgt een eigen bedrag ernaast", () => {
  // Zonder dit zou "€ 2,55 als je ook alternatieven meerekent" naast het harde
  // referentiebedrag komen te staan, dat over minder regels gaat. Dezelfde
  // scheefheid als hierboven, één alinea lager op het scherm.
  const comparison = compareBasket(
    [line()],
    new Map([
      [
        "regel-melk",
        [candidate({ name: "AH Houdbare halfvolle melk", price: 0.85, productId: "ah-houdbaar" })],
      ],
    ]),
    ["AH"]
  );
  const total = comparison.totals.get("AH")!;
  assert.equal(total.alternativeTotal, 2.55);
  assert.equal(total.referenceTotalForHardLines, 0, "in het harde bedrag zit deze regel niet");
  assert.equal(total.referenceTotalForAlternativeLines, 4.35, "in het alternatieve bedrag wel");
});

test("het mandje: '2x brood' is een aantal, geen hoeveelheid", () => {
  // Vaste boodschappen in stuks zijn een door de gebruiker gekozen aantal
  // verpakkingen. Dat als 2 gram lezen zou één verpakking opleveren in plaats
  // van twee — en dus de helft van het bedrag.
  const comparison = compareBasket(
    [
      line({
        ingredientName: "Brood",
        neededQuantity: 2,
        unit: "PIECE",
        quantityIsPackageCount: true,
        reference: { ...line().reference!, packageQuantity: 800, packageUnit: "GRAM", price: 1.2 },
      }),
    ],
    new Map([["regel-melk", [candidate({ packageQuantity: 800, packageUnit: "GRAM", price: 1.1 })]]]),
    ["AH"]
  );
  const result = comparison.lines[0].stores.get("AH")!;
  assert.equal(result.packagesToBuy, 2);
  assert.equal(result.cost, 2.2);
  assert.equal(comparison.referenceTotal, 2.4, "en aan onze kant precies zo geteld");
});

test("het mandje: een verpakking in een andere eenheid levert geen bedrag op", () => {
  // "2 stuks" tegen "1000 ml per verpakking" afzetten geeft een getal dat
  // nergens op slaat. Dan liever niets zeggen.
  const comparison = compareBasket(
    [line({ neededQuantity: 2, unit: "PIECE" })],
    new Map([["regel-melk", [candidate()]]]),
    ["AH"]
  );
  const result = comparison.lines[0].stores.get("AH")!;
  assert.equal(result.cost, null);
  assert.equal(result.missingReason, "verpakking in een andere eenheid");
  assert.equal(comparison.totals.get("AH")!.hardTotal, 0);
});

test("het mandje: een actie telt mee in het bedrag, met het echte mechanisme", () => {
  // 3 liter melk is 3 pakken; met 1+1 gratis betaal je er twee. Het bedrag op
  // het scherm hoort te kloppen met de kassabon, niet met het bordje.
  const comparison = compareBasket(
    [line()],
    new Map([["regel-melk", [candidate({ promoLabel: "1+1 gratis" })]]]),
    ["AH"]
  );
  const result = comparison.lines[0].stores.get("AH")!;
  assert.equal(result.cost, 2.58, "2 pakken van € 1,29");
  assert.equal(result.costWithoutPromo, 3.87);
  assert.match(result.promoExplanation!, /3 halen, 2 betalen/);
  assert.equal(comparison.totals.get("AH")!.hardTotal, 2.58);
});

test("het mandje: een verlopen actie wordt niet toegepast", () => {
  const comparison = compareBasket(
    [line()],
    new Map([
      [
        "regel-melk",
        [candidate({ promoLabel: "1+1 gratis", promoUntil: new Date("2026-08-01T00:00:00Z") })],
      ],
    ]),
    ["AH"],
    new Date("2026-08-28T05:00:00Z")
  );
  assert.equal(comparison.lines[0].stores.get("AH")!.cost, 3.87, "gewoon drie pakken");
});

test("het mandje: een nepkorting wordt gemarkeerd, niet verzwegen", () => {
  const comparison = compareBasket(
    [line()],
    new Map([["regel-melk", [candidate({ wasPrice: 1.99, fakeDiscount: true })]]]),
    ["AH"]
  );
  const result = comparison.lines[0].stores.get("AH")!;
  assert.equal(result.fakeDiscount, true);
  assert.equal(result.cost, 3.87, "de prijs blijft wat hij is");
});

test("het mandje: de oudste prijs in het totaal wordt onthouden", () => {
  const ouder = new Date("2026-08-20T05:00:00Z");
  const comparison = compareBasket(
    [line(), line({ lineId: "regel-2" })],
    new Map([
      ["regel-melk", [candidate()]],
      ["regel-2", [candidate({ observedAt: ouder, stale: true, productId: "ah-oud" })]],
    ]),
    ["AH"]
  );
  const total = comparison.totals.get("AH")!;
  assert.equal(total.oldestObservation?.toISOString(), ouder.toISOString());
  assert.equal(total.anyStale, true);
});

test("het mandje: '3x Alpro' is drie van ónze verpakkingen, niet drie vierpakken", () => {
  // Echt voorbeeld uit productiegebruik: Picnic € 8,97 voor 3 stuks, en de app
  // rekende bij Albert Heijn 3 × een vierpak van € 10,98 = € 32,94. Dat koopt
  // er twaalf terwijl je er drie wilde.
  const comparison = compareBasket(
    [
      line({
        ingredientName: "Alpro",
        neededQuantity: 3,
        unit: "PIECE",
        quantityIsPackageCount: true,
        reference: {
          name: "Alpro mild & creamy naturel",
          brand: "Alpro",
          packageSize: "1 stuk",
          qualityTier: "STANDAARD",
          gtin: null,
          price: 2.99,
          packageQuantity: 1,
          packageUnit: "PIECE",
        },
      }),
    ],
    new Map([
      [
        "regel-melk",
        [
          candidate({
            name: "AH Alpro mild & creamy naturel",
            packageSize: "4 stuks",
            packageQuantity: 4,
            packageUnit: "PIECE",
            price: 10.98,
          }),
        ],
      ],
    ]),
    ["AH"]
  );

  const result = comparison.lines[0].stores.get("AH")!;
  assert.equal(result.packagesToBuy, 1, "één vierpak dekt drie stuks");
  assert.equal(result.cost, 10.98);
  assert.equal(result.surplus, 1, "je houdt er wel één over");
  assert.equal(comparison.referenceTotal, 8.97, "en onze eigen kant blijft 3 × € 2,99");
});

test("het mandje: zonder onze eigen verpakkingsinhoud rekent hij een aantal niet om", () => {
  // Liever niets zeggen dan een bedrag dat er twaalf koopt.
  const comparison = compareBasket(
    [
      line({
        neededQuantity: 3,
        unit: "PIECE",
        quantityIsPackageCount: true,
        reference: { ...line().reference!, packageQuantity: null, packageUnit: null, price: 2.99 },
      }),
    ],
    new Map([["regel-melk", [candidate({ packageQuantity: 4, packageUnit: "PIECE", price: 10.98 })]]]),
    ["AH"]
  );
  const result = comparison.lines[0].stores.get("AH")!;
  assert.equal(result.cost, null);
  assert.equal(result.missingReason, "verpakkingen niet te vergelijken");
});

test("het mandje: één stuk nodig blijft gewoon één verpakking bij elke winkel", () => {
  // Hier is "koop er daar ook één" precies wat je wilt, ook als er meer in zit;
  // de verpakkingsgrootte staat ernaast zodat het verschil zichtbaar is.
  const comparison = compareBasket(
    [
      line({
        neededQuantity: 1,
        unit: "PIECE",
        quantityIsPackageCount: true,
        reference: { ...line().reference!, packageQuantity: null, packageUnit: null, price: 3.49 },
      }),
    ],
    new Map([["regel-melk", [candidate({ packageQuantity: 380, packageUnit: "GRAM", price: 2.95 })]]]),
    ["AH"]
  );
  assert.equal(comparison.lines[0].stores.get("AH")!.cost, 2.95);
});
