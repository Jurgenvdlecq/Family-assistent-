import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePromoType,
  readFreeFromAllergens,
  readGtin,
  toAhProviderProduct,
} from "./ahProvider";

/**
 * De antwoordvormen komen uit de opdracht (live geverifieerd op 28-08-2026).
 * Deze tests hebben bewust geen internet nodig: het ontleden is waar de
 * fouten zitten, en dat moet los van de bereikbaarheid van AH te testen zijn.
 */

const MELK = {
  webshopId: 100311,
  title: "AH Halfvolle melk",
  brand: "AH",
  salesUnitSize: "1 l",
  currentPrice: 1.29,
  priceBeforeBonus: 1.29,
  isBonus: false,
  unitPriceDescription: "prijs per liter €1.29",
};

test("AH-zoekresultaat wordt een bruikbaar product", () => {
  const product = toAhProviderProduct(MELK)!;
  assert.equal(product.provider, "AH");
  assert.equal(product.externalRef, "100311");
  assert.equal(product.name, "AH Halfvolle melk");
  assert.equal(product.price, 1.29);
  assert.deepEqual(product.content, { amount: 1000, unit: "ML" });
  assert.ok(product.unitPrice);
  assert.equal(product.unitPrice!.unit, "ML");
});

test("een van-prijs gelijk aan de huidige prijs is geen korting", () => {
  // AH vult `priceBeforeBonus` ook als er niets in de bonus is. Dat als
  // van-prijs tonen zou een korting suggereren die er niet is.
  const product = toAhProviderProduct(MELK)!;
  assert.equal(product.wasPrice, null);
});

test("een echte actie bewaart de van-prijs en de einddatum", () => {
  const product = toAhProviderProduct({
    ...MELK,
    currentPrice: 0.99,
    priceBeforeBonus: 1.29,
    isBonus: true,
    discountLabels: [{ code: "DISCOUNT_1_PLUS_1_FREE", defaultDescription: "1+1 gratis" }],
    bonusEndDate: "2026-09-01",
  })!;
  assert.equal(product.price, 0.99);
  assert.equal(product.wasPrice, 1.29);
  assert.equal(product.promoLabel, "1+1 gratis");
  assert.equal(product.promoUntil?.toISOString().slice(0, 10), "2026-09-01");
});

test("een resultaat zonder prijs of id wordt overgeslagen, niet op nul gezet", () => {
  // Een regel met prijs nul zou AH ten onrechte de goedkoopste maken.
  assert.equal(toAhProviderProduct({ title: "Zonder id", currentPrice: 1.0 }), null);
  assert.equal(toAhProviderProduct({ webshopId: 1, title: "Zonder prijs" }), null);
  assert.equal(toAhProviderProduct({ webshopId: 1, currentPrice: 1.0 }), null, "zonder naam ook niet");
});

test("kortingsmechanismen worden herkend", () => {
  assert.equal(parsePromoType([{ defaultDescription: "1+1 gratis" }], true), "X_VOOR_Y");
  assert.equal(parsePromoType([{ defaultDescription: "2e halve prijs" }], true), "X_VOOR_Y");
  assert.equal(parsePromoType([{ defaultDescription: "3 voor 5.00" }], true), "X_VOOR_Y");
  assert.equal(parsePromoType([{ defaultDescription: "25% korting" }], true), "BONUS");
  assert.equal(parsePromoType([], false), "GEEN");
});

test("de barcode komt van het detailscherm", () => {
  assert.equal(readGtin({ tradeItem: { gtin: "08710400003601" } }), "08710400003601");
  assert.equal(readGtin({ tradeItem: {} }), null);
  assert.equal(readGtin({}), null);
});

test("alleen FREE_FROM telt als 'vrij van'", () => {
  // Bij een allergie is "waarschijnlijk vrij van" gelijk aan onbruikbaar.
  const allergens = readFreeFromAllergens({
    tradeItem: {
      allergenInformation: [
        { allergenTypeCode: "AF", levelOfContainmentCode: "FREE_FROM" },
        { allergenTypeCode: "AM", levelOfContainmentCode: "MAY_CONTAIN" },
        { allergenTypeCode: "AP", levelOfContainmentCode: "CONTAINS" },
      ],
    },
  });
  assert.deepEqual(allergens, ["vis"], "alleen vis is echt uitgesloten");
});

test("onbekende allergeencodes worden genegeerd, niet geraden", () => {
  const allergens = readFreeFromAllergens({
    tradeItem: { allergenInformation: [{ allergenTypeCode: "XYZ", levelOfContainmentCode: "FREE_FROM" }] },
  });
  assert.deepEqual(allergens, []);
});
