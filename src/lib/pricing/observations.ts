import { prisma } from "@/lib/prisma";
import type { ObservationSource, ProductProvider } from "@/generated/prisma/enums";
import type { ProviderProduct } from "@/domain/pricing/types";
import { deriveQualityTier } from "@/domain/pricing/qualityTier";
import { parsePackContent, unitPriceFor } from "@/domain/pricing/unitPrice";

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
  const { product } = input;
  const observedAt = input.observedAt ?? new Date();
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

  const stored = await prisma.product.upsert({
    where: {
      ingredientId_provider_externalRef: {
        ingredientId: input.ingredientId,
        provider: product.provider,
        externalRef: product.externalRef,
      },
    },
    create: {
      ingredientId: input.ingredientId,
      provider: product.provider,
      externalRef: product.externalRef,
      name: product.name,
      brand: product.brand,
      packageSize: product.packageSize,
      packageQuantity,
      price: product.price,
      qualityTier,
      gtin: product.gtin,
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
      // Een barcode die er al is nooit wissen: als een provider hem een keer
      // niet meestuurt, is dat geen bewijs dat hij niet bestaat.
      ...(product.gtin ? { gtin: product.gtin } : {}),
      lastSeenAvailable: observedAt,
    },
  });

  await prisma.priceObservation.create({
    data: {
      productId: stored.id,
      price: product.price,
      wasPrice: product.wasPrice,
      unitPrice: product.unitPrice?.amount ?? null,
      unitPriceUnit: product.unitPrice?.unit ?? null,
      promoType: product.promoType,
      promoLabel: product.promoLabel,
      promoUntil: product.promoUntil,
      observedAt,
      source: input.source,
    },
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
export async function getLatestPrices(productIds: string[]): Promise<Map<string, LatestPrice>> {
  if (productIds.length === 0) return new Map();

  const observations = await prisma.priceObservation.findMany({
    where: { productId: { in: productIds } },
    orderBy: { observedAt: "desc" },
    include: { product: { select: { provider: true } } },
  });

  const latest = new Map<string, LatestPrice>();
  for (const observation of observations) {
    if (latest.has(observation.productId)) continue;
    latest.set(observation.productId, {
      productId: observation.productId,
      provider: observation.product.provider,
      price: Number(observation.price),
      wasPrice: observation.wasPrice === null ? null : Number(observation.wasPrice),
      unitPrice: observation.unitPrice === null ? null : Number(observation.unitPrice),
      unitPriceUnit: observation.unitPriceUnit,
      promoType: observation.promoType,
      promoLabel: observation.promoLabel,
      promoUntil: observation.promoUntil,
      observedAt: observation.observedAt,
      source: observation.source,
    });
  }
  return latest;
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
