/**
 * Integratietest tegen een echte (lokale) Postgres: de dagelijkse
 * prijsverversing.
 *
 * De winkel zelf is een neppe provider. Dat is hier niet alleen praktisch
 * (api.ah.nl is vanuit deze omgeving onbereikbaar) maar ook juist: wat getest
 * moet worden is hoe de verversing zich gedraagt — welke ingrediënten ze
 * bevraagt, wat ze opslaat, en vooral wat ze doet als de winkel niet
 * meewerkt.
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { refreshStorePrices } from "./pricing/refresh";
import { getStorePricesForIngredients } from "./pricing/storePrices";
import type { ProviderProduct, StorePriceProvider } from "@/domain/pricing/types";

function fakeProduct(name: string, price: number, packageSize = "1 l"): ProviderProduct {
  return {
    provider: "AH",
    externalRef: `nep-${name.toLowerCase().replace(/\W+/g, "-")}`,
    name,
    brand: "AH",
    packageSize,
    content: packageSize === "1 l" ? { amount: 1000, unit: "ML" } : null,
    price,
    wasPrice: null,
    unitPrice: null,
    promoType: "GEEN",
    promoLabel: null,
    promoUntil: null,
    gtin: null,
    labels: [],
    freeFromAllergens: [],
    imageId: null,
  };
}

function fakeProvider(behaviour: (term: string) => Promise<ProviderProduct[]>): StorePriceProvider {
  return {
    provider: "AH",
    label: "Albert Heijn (nep)",
    capabilities: { hasEan: false, hasAllergens: false, hasUnitPrice: false, canOrder: false, reliability: "api" },
    search: (term) => behaviour(term),
  };
}

async function cleanupAhProducts() {
  const products = await prisma.product.findMany({ where: { provider: "AH" }, select: { id: true } });
  const ids = products.map((product) => product.id);
  await prisma.priceObservation.deleteMany({ where: { productId: { in: ids } } });
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
}

test("verversing: bevraagt alleen ingrediënten die we ook echt gebruiken", async () => {
  // Het hele assortiment ophalen zou veel verkeer zijn en niets toevoegen:
  // wat we nooit kopen hoeft geen prijs te hebben.
  const asked: string[] = [];
  try {
    await refreshStorePrices(
      fakeProvider(async (term) => {
        asked.push(term);
        return [];
      }),
      { limitIngredients: 5 }
    );

    assert.equal(asked.length, 5);
    const used = await prisma.ingredient.count({
      where: { name: { in: asked }, OR: [{ recipeIngredients: { some: {} } }, { fixedGroceries: { some: {} } }] },
    });
    assert.equal(used, asked.length, "elk bevraagd ingrediënt komt in een recept of vaste boodschap voor");
  } finally {
    await cleanupAhProducts();
  }
});

test("verversing: slaat de gevonden producten op met een prijswaarneming", async () => {
  try {
    const result = await refreshStorePrices(
      fakeProvider(async (term) => [fakeProduct(`AH ${term}`, 1.29)]),
      { limitIngredients: 3 }
    );

    assert.equal(result.ingredientsChecked, 3);
    assert.ok(result.productsStored > 0);
    assert.equal(result.errors.length, 0);

    const stored = await prisma.product.count({ where: { provider: "AH" } });
    assert.equal(stored, result.productsStored);
    const observations = await prisma.priceObservation.count({
      where: { product: { provider: "AH" } },
    });
    assert.equal(observations, result.productsStored, "elk opgeslagen product heeft een waarneming");
  } finally {
    await cleanupAhProducts();
  }
});

test("verversing: een ingrediënt zonder passend product wordt geteld, niet stilzwijgend genegeerd", async () => {
  try {
    const result = await refreshStorePrices(
      // De winkel geeft wel iets terug, maar niets wat bij het ingrediënt past.
      fakeProvider(async () => [fakeProduct("Volstrekt iets anders", 9.99)]),
      { limitIngredients: 4 }
    );
    assert.equal(result.ingredientsWithoutMatch, 4);
    assert.equal(result.productsStored, 0);
  } finally {
    await cleanupAhProducts();
  }
});

test("verversing: tien fouten op rij is een storing en stopt de rest", async () => {
  // Doorgaan zou honderden mislukkende aanroepen betekenen; dan is de
  // koppeling stuk, niet het assortiment.
  let calls = 0;
  try {
    const result = await refreshStorePrices(
      fakeProvider(async () => {
        calls += 1;
        throw new Error("winkel onbereikbaar");
      }),
      { limitIngredients: 50 }
    );
    assert.equal(result.abortedAfter, 10);
    assert.equal(calls, 10, "er wordt niet doorgeramd na een duidelijke storing");
    assert.equal(result.productsStored, 0);
  } finally {
    await cleanupAhProducts();
  }
});

test("verversing: een enkele fout onderbreekt de rest niet", async () => {
  try {
    let first = true;
    const result = await refreshStorePrices(
      fakeProvider(async (term) => {
        if (first) {
          first = false;
          throw new Error("eenmalige hapering");
        }
        return [fakeProduct(`AH ${term}`, 1.0)];
      }),
      { limitIngredients: 4 }
    );
    assert.equal(result.errors.length, 1);
    assert.equal(result.abortedAfter, null);
    assert.ok(result.productsStored >= 3, "de overige ingrediënten zijn gewoon opgehaald");
  } finally {
    await cleanupAhProducts();
  }
});

test("winkelprijzen: de lijst leest alleen wat er is opgeslagen, en verzint geen nul", async () => {
  const ingredients = await prisma.ingredient.findMany({
    where: { OR: [{ recipeIngredients: { some: {} } }, { fixedGroceries: { some: {} } }] },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 3,
  });
  try {
    await refreshStorePrices(
      fakeProvider(async (term) => (term === ingredients[0].name ? [fakeProduct(`AH ${term}`, 2.5)] : [])),
      { limitIngredients: 3 }
    );

    const prices = await getStorePricesForIngredients(
      ingredients.map((ingredient) => ingredient.id),
      ["AH"]
    );
    assert.equal(prices.get(ingredients[0].id)?.get("AH")?.price, 2.5);
    assert.equal(
      prices.has(ingredients[1].id),
      false,
      "een ingrediënt zonder waarneming hoort te ontbreken, niet nul te kosten"
    );
  } finally {
    await cleanupAhProducts();
  }
});
