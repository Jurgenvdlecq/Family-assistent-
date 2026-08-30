import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { ObservationSource, ProductProvider, PromoType, Unit } from "@/generated/prisma/enums";
import type { ProviderProduct } from "@/domain/pricing/types";
import { deriveQualityTier } from "@/domain/pricing/qualityTier";
import { parsePackContent, unitPriceFor } from "@/domain/pricing/unitPrice";
import type { PriceSample } from "@/domain/pricing/priceHistory";

/**
 * Prijswaarnemingen opslaan en teruglezen.
 *
 * De regel die dit bestand bij elkaar houdt: een prijs is een waarneming op
 * een moment, geen eigenschap van een product. `Product.price` blijft wel
 * bijgewerkt worden als "laatst bekende prijs", zodat alle bestaande schermen
 * ongewijzigd blijven werken — maar elke vergelijking leest uit de
 * waarnemingen, zodat ze kan zeggen van wanneer de prijzen zijn.
 */

/** Hoe lang een waarneming bruikbaar is voordat de app hem "oud" noemt. */
export const PRICE_FRESHNESS_HOURS = 36;

export function isPriceStale(observedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - observedAt.getTime() > PRICE_FRESHNESS_HOURS * 60 * 60 * 1000;
}

/**
 * Slaat één waargenomen product op: het product zelf (aanmaken of bijwerken)
 * plus een nieuwe prijswaarneming.
 *
 * Bewust altijd een nieuwe waarneming, ook als de prijs gelijk is gebleven:
 * "de prijs was gisteren ook al €1,29" is zelf informatie — zonder dat is een
 * nep-korting niet te herkennen.
 */
/**
 * De velden waarmee één waargenomen product wordt aangemaakt of bijgewerkt.
 *
 * Apart gezet zodat het opslaan van één product en het bundelen van een hele
 * reeks gegarandeerd hetzelfde wegschrijven — anders groeien die twee wegen
 * uit elkaar zodra er een veld bij komt.
 */
function upsertArgsFor(product: ProviderProduct, ingredientId: string, observedAt: Date) {
  const qualityTier = deriveQualityTier({
    provider: product.provider,
    name: product.name,
    brand: product.brand,
    labels: product.labels,
  });
  // De inhoud in basiseenheden is wat de verpakkingsberekening nodig heeft.
  // Onbekend blijft onbekend: `null` leidt verderop tot "verpakking onbekend"
  // in plaats van een geraden aantal.
  const packageQuantity = product.content?.amount ?? null;

  return {
    where: {
      ingredientId_provider_externalRef: {
        ingredientId,
        provider: product.provider,
        externalRef: product.externalRef,
      },
    },
    create: {
      ingredientId,
      provider: product.provider,
      externalRef: product.externalRef,
      name: product.name,
      brand: product.brand,
      packageSize: product.packageSize,
      packageQuantity,
      price: product.price,
      qualityTier,
      productUrl: product.url,
      gtin: product.gtin,
      freeFromAllergens: product.freeFromAllergens,
      picnicImageId: product.provider === "PICNIC" ? product.imageId : null,
      lastSeenAvailable: observedAt,
    },
    update: {
      name: product.name,
      brand: product.brand,
      packageSize: product.packageSize,
      packageQuantity,
      // Laatst bekende prijs bijwerken zodat bestaande schermen kloppen.
      price: product.price,
      qualityTier,
      productUrl: product.url,
      // Een barcode die er al is nooit wissen: als een provider hem een keer
      // niet meestuurt, is dat geen bewijs dat hij niet bestaat.
      ...(product.gtin ? { gtin: product.gtin } : {}),
      // Alleen overschrijven als de winkel er iets over zei: een leeg antwoord
      // is geen bewijs dat het product de allergeen wél bevat.
      ...(product.freeFromAllergens.length > 0 ? { freeFromAllergens: product.freeFromAllergens } : {}),
      lastSeenAvailable: observedAt,
    },
  };
}

/** De waarneming die bij dat product hoort. */
function observationDataFor(
  product: ProviderProduct,
  productId: string,
  observedAt: Date,
  source: ObservationSource
) {
  return {
    productId,
    price: product.price,
    wasPrice: product.wasPrice,
    unitPrice: product.unitPrice?.amount ?? null,
    unitPriceUnit: product.unitPrice?.unit ?? null,
    promoType: product.promoType,
    promoLabel: product.promoLabel,
    promoUntil: product.promoUntil,
    observedAt,
    source,
  };
}

export async function recordObservedProduct(input: {
  product: ProviderProduct;
  /**
   * Bij welk ingrediënt dit product hoort. Verplicht: een winkelproduct
   * zonder ingrediënt heeft niets om mee vergeleken te worden, en de app
   * zoekt sowieso pér ingrediënt.
   */
  ingredientId: string;
  source: ObservationSource;
  observedAt?: Date;
}) {
  const observedAt = input.observedAt ?? new Date();
  const stored = await prisma.product.upsert(
    upsertArgsFor(input.product, input.ingredientId, observedAt)
  );
  await prisma.priceObservation.create({
    data: observationDataFor(input.product, stored.id, observedAt, input.source),
  });
  return stored;
}

export async function recordObservedProducts(input: {
  products: ProviderProduct[];
  ingredientId: string;
  source: ObservationSource;
  observedAt?: Date;
}) {
  if (input.products.length === 0) return [];
  const observedAt = input.observedAt ?? new Date();

  const stored = await Promise.all(
    input.products.map((product) =>
      prisma.product.upsert(upsertArgsFor(product, input.ingredientId, observedAt))
    )
  );

  await prisma.priceObservation.createMany({
    data: stored.map((row, index) => observationDataFor(input.products[index], row.id, observedAt, input.source)),
  });

  return stored;
}

export interface LatestPrice {
  productId: string;
  provider: ProductProvider;
  price: number;
  wasPrice: number | null;
  unitPrice: number | null;
  unitPriceUnit: "GRAM" | "ML" | "PIECE" | null;
  promoType: string;
  promoLabel: string | null;
  promoUntil: Date | null;
  observedAt: Date;
  source: ObservationSource;
}

/**
 * De meest recente waarneming per product, voor een verzameling producten in
 * één query.
 *
 * Bewust niet per product apart opvragen: een vergelijking gaat over een hele
 * boodschappenlijst, en dat zou tientallen queries per paginabezoek worden.
 */
/** Eén rij zoals Postgres 'm teruggeeft — kolomnamen, niet veldnamen. */
interface LatestPriceRow {
  product_id: string;
  provider: ProductProvider;
  price: string | number;
  was_price: string | number | null;
  unit_price: string | number | null;
  unit_price_unit: Unit | null;
  promo_type: PromoType;
  promo_label: string | null;
  promo_until: Date | null;
  observed_at: Date;
  source: ObservationSource;
}

export async function getLatestPrices(productIds: string[]): Promise<Map<string, LatestPrice>> {
  if (productIds.length === 0) return new Map();

  // `DISTINCT ON` in plaats van "alles ophalen en in JavaScript de nieuwste
  // uitzoeken". Dat laatste stond hier, en het werkte prima zolang er weinig
  // waarnemingen waren — maar elke verversing schrijft er per product één bij.
  // Deze query haalde dus élke prijs op die ooit is vastgelegd, elke keer dat
  // de prijzenpagina werd getoond, en werd daarmee met de dag trager. De
  // functie hieronder waarschuwt daar in haar eigen comment nog voor ("zodat
  // één product met dagelijkse waarnemingen de query niet laat ontsporen") —
  // die begrenzing ontbrak hier gewoon.
  //
  // Met de bestaande index op (product_id, observed_at) leest Postgres nu per
  // product alleen de bovenste rij. Bewust ruwe SQL: dit is precies het soort
  // query waar `DISTINCT ON` voor bestaat en waar de Prisma-client geen
  // equivalent voor heeft.
  const rows = await prisma.$queryRaw<LatestPriceRow[]>`
    SELECT DISTINCT ON (o.product_id)
      o.product_id, p.provider, o.price, o.was_price, o.unit_price, o.unit_price_unit,
      o.promo_type, o.promo_label, o.promo_until, o.observed_at, o.source
    FROM price_observations o
    JOIN products p ON p.id = o.product_id
    WHERE o.product_id IN (${Prisma.join(productIds)})
    ORDER BY o.product_id, o.observed_at DESC
  `;

  const latest = new Map<string, LatestPrice>();
  for (const row of rows) {
    latest.set(row.product_id, {
      productId: row.product_id,
      provider: row.provider,
      price: Number(row.price),
      wasPrice: row.was_price === null ? null : Number(row.was_price),
      unitPrice: row.unit_price === null ? null : Number(row.unit_price),
      unitPriceUnit: row.unit_price_unit,
      promoType: row.promo_type,
      promoLabel: row.promo_label,
      promoUntil: row.promo_until,
      observedAt: row.observed_at,
      source: row.source,
    });
  }
  return latest;
}

/**
 * Het prijsverloop per product, voor het beoordelen van een actie.
 *
 * Precies waarvoor `PriceObservation` een reeks is en geen veld: pas met een
 * geschiedenis kun je zien of een van-prijs ooit echt gerekend werd. Bewust
 * begrensd in de tijd — wat twee jaar geleden gold zegt niets over vandaag —
 * en in aantal, zodat één product met dagelijkse waarnemingen de query niet
 * laat ontsporen.
 */
export async function getPriceHistories(
  productIds: string[],
  sinceDays = 60
): Promise<Map<string, PriceSample[]>> {
  const result = new Map<string, PriceSample[]>();
  if (productIds.length === 0) return result;

  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const observations = await prisma.priceObservation.findMany({
    where: { productId: { in: productIds }, observedAt: { gte: since } },
    orderBy: { observedAt: "desc" },
    select: { productId: true, price: true, wasPrice: true, observedAt: true },
    take: 2000,
  });

  for (const observation of observations) {
    const list = result.get(observation.productId) ?? [];
    list.push({
      price: Number(observation.price),
      wasPrice: observation.wasPrice === null ? null : Number(observation.wasPrice),
      observedAt: observation.observedAt,
    });
    result.set(observation.productId, list);
  }
  return result;
}

/**
 * Legt één prijs vast bij een product dat al bestaat.
 *
 * Bedoeld voor de plekken waar de app tóch al een prijs ziet — zoals het
 * kiezen van een Picnic-product. Zo groeit de prijsgeschiedenis vanzelf mee
 * zonder dat daar een aparte verversing voor nodig is.
 */
export async function recordPriceObservation(input: {
  productId: string;
  price: number;
  packageSize: string | null;
  source: ObservationSource;
  observedAt?: Date;
}) {
  const content = parsePackContent(input.packageSize);
  const unitPrice = unitPriceFor(input.price, content);
  await prisma.priceObservation.create({
    data: {
      productId: input.productId,
      price: input.price,
      unitPrice: unitPrice?.amount ?? null,
      unitPriceUnit: unitPrice?.unit ?? null,
      promoType: "GEEN",
      observedAt: input.observedAt ?? new Date(),
      source: input.source,
    },
  });
}
