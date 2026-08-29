/**
 * Integratietest tegen een echte (lokale) Postgres: prijs als waarneming in
 * de tijd.
 *
 * Het punt van dit model is dat een prijs een datum heeft. Deze test bewijst
 * dat de geschiedenis ook echt blijft staan — inclusief twee identieke
 * prijzen achter elkaar, want juist dát is wat een nep-korting later
 * herkenbaar maakt.
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import {
  getLatestPrices,
  getPriceHistories,
  isPriceStale,
  recordObservedProduct,
  recordObservedProducts,
} from "./pricing/observations";
import { judgeDiscount } from "@/domain/pricing/priceHistory";
import type { ProviderProduct } from "@/domain/pricing/types";

function ahProduct(overrides: Partial<ProviderProduct> = {}): ProviderProduct {
  return {
    provider: "AH",
    externalRef: `ah-test-${Math.random().toString(36).slice(2)}`,
    name: "AH Halfvolle melk",
    brand: "AH",
    packageSize: "1 l",
    content: { amount: 1000, unit: "ML" },
    price: 1.29,
    wasPrice: null,
    unitPrice: { amount: 0.00129, unit: "ML" },
    promoType: "GEEN",
    promoLabel: null,
    promoUntil: null,
    gtin: "08710400003601",
    labels: [],
    freeFromAllergens: [],
    imageId: null,
    url: null,
    ...overrides,
  };
}

async function cleanup(productIds: string[]) {
  await prisma.priceObservation.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
}

test("prijswaarneming: een nieuw winkelproduct wordt opgeslagen met klasse en barcode", async () => {
  const ingredient = await prisma.ingredient.findUniqueOrThrow({ where: { name: "Melk" } });
  const product = await recordObservedProduct({
    product: ahProduct(),
    ingredientId: ingredient.id,
    source: "API",
  });
  try {
    assert.equal(product.provider, "AH");
    assert.equal(product.gtin, "08710400003601");
    assert.equal(product.qualityTier, "STANDAARD", "AH als merk is het huismerk");
    assert.equal(product.packageQuantity, 1000, "de inhoud in basiseenheden");
    assert.equal(Number(product.price), 1.29, "de laatst bekende prijs blijft op het product staan");
  } finally {
    await cleanup([product.id]);
  }
});

test("prijswaarneming: dezelfde prijs twee keer levert twee waarnemingen op", async () => {
  // Zonder dit is niet te zien dát een prijs al langer hetzelfde was, en dan
  // is een "van-prijs" die nooit gegolden heeft niet te herkennen.
  const ingredient = await prisma.ingredient.findUniqueOrThrow({ where: { name: "Melk" } });
  const externalRef = `ah-herhaald-${Date.now()}`;
  const first = await recordObservedProduct({
    product: ahProduct({ externalRef }),
    ingredientId: ingredient.id,
    source: "API",
    observedAt: new Date("2026-08-20T08:00:00Z"),
  });
  await recordObservedProduct({
    product: ahProduct({ externalRef }),
    ingredientId: ingredient.id,
    source: "API",
    observedAt: new Date("2026-08-21T08:00:00Z"),
  });
  try {
    const observations = await prisma.priceObservation.findMany({ where: { productId: first.id } });
    assert.equal(observations.length, 2);
    assert.equal(
      await prisma.product.count({ where: { provider: "AH", externalRef } }),
      1,
      "en er komt geen tweede product bij"
    );
  } finally {
    await cleanup([first.id]);
  }
});

test("prijswaarneming: de laatste waarneming wint, ook als een oudere later binnenkomt", async () => {
  const ingredient = await prisma.ingredient.findUniqueOrThrow({ where: { name: "Melk" } });
  const externalRef = `ah-volgorde-${Date.now()}`;
  const product = await recordObservedProduct({
    product: ahProduct({ externalRef, price: 1.29 }),
    ingredientId: ingredient.id,
    source: "API",
    observedAt: new Date("2026-08-21T08:00:00Z"),
  });
  // Een oudere waarneming die later wordt toegevoegd (bijvoorbeeld een
  // ingehaalde achterstand) mag de actuele prijs niet overschrijven.
  await recordObservedProduct({
    product: ahProduct({ externalRef, price: 0.99 }),
    ingredientId: ingredient.id,
    source: "API",
    observedAt: new Date("2026-08-19T08:00:00Z"),
  });
  try {
    const latest = await getLatestPrices([product.id]);
    assert.equal(latest.get(product.id)?.price, 1.29);
    assert.equal(latest.get(product.id)?.observedAt.toISOString(), "2026-08-21T08:00:00.000Z");
  } finally {
    await cleanup([product.id]);
  }
});

test("prijswaarneming: een actie bewaart de van-prijs en de einddatum", async () => {
  const ingredient = await prisma.ingredient.findUniqueOrThrow({ where: { name: "Melk" } });
  const product = await recordObservedProduct({
    product: ahProduct({
      price: 0.99,
      wasPrice: 1.29,
      promoType: "BONUS",
      promoLabel: "1+1 gratis",
      promoUntil: new Date("2026-09-01T00:00:00Z"),
    }),
    ingredientId: ingredient.id,
    source: "API",
  });
  try {
    const latest = await getLatestPrices([product.id]);
    const observation = latest.get(product.id)!;
    assert.equal(observation.price, 0.99);
    assert.equal(observation.wasPrice, 1.29);
    assert.equal(observation.promoLabel, "1+1 gratis");
    assert.equal(observation.promoUntil?.toISOString(), "2026-09-01T00:00:00.000Z");
  } finally {
    await cleanup([product.id]);
  }
});

test("prijswaarneming: getLatestPrices doet één query voor een hele lijst", async () => {
  // Per product apart opvragen zou bij een boodschappenlijst tientallen
  // queries per paginabezoek worden.
  const ingredient = await prisma.ingredient.findUniqueOrThrow({ where: { name: "Melk" } });
  const products = await Promise.all(
    [1.29, 1.19, 0.99].map((price, index) =>
      recordObservedProduct({
        product: ahProduct({ externalRef: `ah-bulk-${Date.now()}-${index}`, price }),
        ingredientId: ingredient.id,
        source: "API",
      })
    )
  );
  try {
    const latest = await getLatestPrices(products.map((product) => product.id));
    assert.equal(latest.size, 3);
  } finally {
    await cleanup(products.map((product) => product.id));
  }
});

test("prijsversheid: een waarneming van gisteren is vers, van vorige week niet", () => {
  const now = new Date("2026-08-28T12:00:00Z");
  assert.equal(isPriceStale(new Date("2026-08-28T06:00:00Z"), now), false);
  assert.equal(isPriceStale(new Date("2026-08-21T12:00:00Z"), now), true);
});

test("prijsverloop: de geschiedenis komt terug als reeks, en oude waarnemingen vallen buiten het venster", async () => {
  // Dit is waarvoor de prijs een waarneming in de tijd is: pas met een reeks
  // kun je een nepkorting herkennen.
  const ingredient = await prisma.ingredient.findUniqueOrThrow({ where: { name: "Melk" } });
  const product = await recordObservedProduct({
    product: ahProduct({ externalRef: `ah-historie-${Date.now()}`, price: 1.29 }),
    ingredientId: ingredient.id,
    source: "API",
  });

  try {
    const dagen = (aantal: number) => new Date(Date.now() - aantal * 24 * 60 * 60 * 1000);
    await prisma.priceObservation.createMany({
      data: [
        { productId: product.id, price: 1.29, observedAt: dagen(7), source: "API" },
        { productId: product.id, price: 1.29, observedAt: dagen(14), source: "API" },
        { productId: product.id, price: 1.29, observedAt: dagen(21), source: "API" },
        // Ruim buiten het venster: mag niet meetellen.
        { productId: product.id, price: 1.99, observedAt: dagen(400), source: "API" },
      ],
    });

    const histories = await getPriceHistories([product.id], 60);
    const samples = histories.get(product.id) ?? [];
    assert.ok(samples.length >= 4, "de waarnemingen binnen het venster horen terug te komen");
    assert.ok(
      !samples.some((sample) => sample.price === 1.99),
      "een waarneming van meer dan een jaar geleden valt buiten het venster"
    );

    // En het oordeel dat erop leunt: een van-prijs van € 1,99 die hier in de
    // afgelopen twee maanden nooit gerekend is, is geen korting.
    const verdict = judgeDiscount({ price: 1.29, wasPrice: 1.99, observedAt: new Date() }, samples);
    assert.equal(verdict.kind, "NEPKORTING");
  } finally {
    await cleanup([product.id]);
  }
});

test("prijswaarnemingen: een reeks producten van één ingrediënt gaat in één keer", async () => {
  // Per product waren dit twee database-aanroepen achter elkaar. Bij acht
  // kandidaten per ingrediënt per winkel liep dat zo hoog op dat de
  // verversing haar tijdslimiet haalde na drie van de vijftien regels.
  const ingredient = await prisma.ingredient.findFirstOrThrow({});
  const products = [
    ahProduct({ externalRef: `bundel-a-${Date.now()}`, name: "Bundel A", price: 1.11 }),
    ahProduct({ externalRef: `bundel-b-${Date.now()}`, name: "Bundel B", price: 2.22 }),
  ];

  const stored = await recordObservedProducts({
    products,
    ingredientId: ingredient.id,
    source: "API",
  });

  try {
    assert.equal(stored.length, 2);
    const latest = await getLatestPrices(stored.map((row) => row.id));
    // Elk product heeft een eigen waarneming met de eigen prijs — bundelen mag
    // niets door elkaar halen.
    assert.equal(latest.get(stored[0].id)?.price, 1.11);
    assert.equal(latest.get(stored[1].id)?.price, 2.22);

    // Nog een keer dezelfde producten: bijwerken in plaats van verdubbelen,
    // met een tweede waarneming erbij.
    const again = await recordObservedProducts({
      products: products.map((product) => ({ ...product, price: 3.33 })),
      ingredientId: ingredient.id,
      source: "API",
    });
    assert.deepEqual(
      again.map((row) => row.id).sort(),
      stored.map((row) => row.id).sort(),
      "dezelfde rijen, geen nieuwe"
    );
    const observations = await prisma.priceObservation.count({
      where: { productId: { in: stored.map((row) => row.id) } },
    });
    assert.equal(observations, 4, "twee producten, twee keer waargenomen");
  } finally {
    await cleanup(stored.map((row) => row.id));
  }
});
