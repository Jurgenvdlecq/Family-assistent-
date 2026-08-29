import { prisma } from "@/lib/prisma";
import type { ProductProvider, QualityTier, Unit } from "@/generated/prisma/enums";
import { rankStoreProducts } from "@/domain/pricing/storeMatch";
import type { ProviderProduct } from "@/domain/pricing/types";
import { displayableProductUrl } from "@/domain/pricing/productUrl";
import { getLatestPrices, isPriceStale } from "./observations";

/**
 * De bekende winkelprijzen per ingrediënt, uit wat de laatste verversing heeft
 * opgeslagen.
 *
 * Leest bewust alleen uit de database: een pagina mag nooit op een externe
 * winkel wachten. Staat er niets, dan is het antwoord "niet gevonden" — en dat
 * hoort ook zo op het scherm te komen, niet als nul.
 */

export interface StorePriceForIngredient {
  provider: ProductProvider;
  productId: string;
  name: string;
  brand: string | null;
  packageSize: string | null;
  /** Inhoud in basiseenheden; `null` als de verpakking niet te lezen was. */
  packageQuantity: number | null;
  unit: Unit | null;
  qualityTier: QualityTier | null;
  gtin: string | null;
  /** Waar deze winkel bevestigt dat het product vrij van is. Leeg = onbekend. */
  freeFromAllergens: string[];
  /** De productpagina bij de winkel, om zelf na te kijken of het hetzelfde is. */
  productUrl: string | null;
  /** Prijs per liter/kilo/stuk, zodat verpakkingsgroottes vergelijkbaar zijn. */
  unitPrice: number | null;
  unitPriceUnit: Unit | null;
  price: number;
  wasPrice: number | null;
  promoLabel: string | null;
  promoUntil: Date | null;
  observedAt: Date;
  /** Ouder dan de versheidsgrens — de UI moet dat erbij zeggen. */
  stale: boolean;
}

/** Per ingrediënt, per winkel: het best passende product met zijn laatste prijs. */
export type StorePricesByIngredient = Map<string, Map<ProductProvider, StorePriceForIngredient>>;

/** Per ingrediënt: alle bruikbare winkelproducten, op volgorde van hoe goed ze passen. */
export type StoreCandidatesByIngredient = Map<string, StorePriceForIngredient[]>;

/**
 * Zoekt voor elk ingrediënt het best passende product per winkel.
 *
 * De rangschikking wordt hier opnieuw uitgerekend met dezelfde functie als de
 * verversing (`rankStoreProducts`), zodat "welk product hoort hierbij" maar op
 * één plek beslist wordt. Alternatief zou een opgeslagen volgorde zijn, maar
 * die veroudert zodra de matchregels veranderen.
 */
export async function getStorePricesForIngredients(
  ingredientIds: string[],
  providers: ProductProvider[],
  now: Date = new Date()
): Promise<StorePricesByIngredient> {
  const candidates = await getStoreCandidatesForIngredients(ingredientIds, providers, 1, now);
  const result: StorePricesByIngredient = new Map();
  for (const [ingredientId, list] of candidates) {
    const perProvider = new Map<ProductProvider, StorePriceForIngredient>();
    for (const candidate of list) {
      // De lijst is al gesorteerd op hoe goed het past; de eerste per winkel wint.
      if (!perProvider.has(candidate.provider)) perProvider.set(candidate.provider, candidate);
    }
    result.set(ingredientId, perProvider);
  }
  return result;
}

/**
 * Specifieke producten opzoeken, buiten de rangschikking om.
 *
 * Nodig voor een handmatige correctie: die is een beslissing, geen suggestie.
 * Zou de gekozen tegenhanger alleen uit de shortlist van de matcher gehaald
 * worden, dan verdwijnt de keuze zodra de matcher later een ander product
 * mooier vindt — en dat zonder melding. Hier wordt hij dus rechtstreeks
 * opgehaald.
 */
export async function getStoreProductsByIds(
  productIds: string[],
  now: Date = new Date()
): Promise<StorePriceForIngredient[]> {
  if (productIds.length === 0) return [];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { ingredient: { select: { unit: true } } },
  });
  const latest = await getLatestPrices(products.map((product) => product.id));

  return products
    .map((product): StorePriceForIngredient | null => {
      const price = latest.get(product.id);
      // Zonder waarneming is er geen prijs — en dat is geen prijs van nul.
      if (!price) return null;
      return {
        provider: product.provider,
        productId: product.id,
        name: product.name,
        brand: product.brand,
        packageSize: product.packageSize,
        packageQuantity: product.packageQuantity,
        unit: product.ingredient?.unit ?? null,
        qualityTier: product.qualityTier,
        gtin: product.gtin,
        freeFromAllergens: product.freeFromAllergens,
        productUrl: displayableProductUrl(product.productUrl),
        unitPrice: price.unitPrice,
        unitPriceUnit: price.unitPriceUnit,
        price: price.price,
        wasPrice: price.wasPrice,
        promoLabel: price.promoLabel,
        promoUntil: price.promoUntil,
        observedAt: price.observedAt,
        stale: isPriceStale(price.observedAt, now),
      };
    })
    .filter((product) => product !== null);
}

/**
 * Alle bruikbare kandidaten per ingrediënt, per winkel — niet alleen de beste.
 *
 * Het mandje doorrekenen heeft meer dan één kandidaat nodig: het beste product
 * op naam is niet altijd het best vergelijkbare product. Houdbare melk kan
 * bovenaan staan terwijl de verse variant er ook is; die keuze hoort bij de
 * equivalentieregels thuis, niet hier. Deze functie levert dus de kandidaten
 * en laat de afweging aan `compareBasket`.
 */
export async function getStoreCandidatesForIngredients(
  ingredientIds: string[],
  providers: ProductProvider[],
  perProviderLimit = 6,
  now: Date = new Date()
): Promise<StoreCandidatesByIngredient> {
  const result: StoreCandidatesByIngredient = new Map();
  if (ingredientIds.length === 0 || providers.length === 0) return result;

  const products = await prisma.product.findMany({
    where: { ingredientId: { in: ingredientIds }, provider: { in: providers } },
    include: { ingredient: { select: { id: true, name: true, unit: true } } },
  });
  if (products.length === 0) return result;

  const latest = await getLatestPrices(products.map((product) => product.id));

  // Per (ingrediënt, winkel) de kandidaten verzamelen en er één kiezen.
  const grouped = new Map<string, typeof products>();
  for (const product of products) {
    if (!product.ingredientId) continue;
    const key = `${product.ingredientId}:${product.provider}`;
    const list = grouped.get(key) ?? [];
    list.push(product);
    grouped.set(key, list);
  }

  for (const [key, candidates] of grouped) {
    const [ingredientId, provider] = key.split(":") as [string, ProductProvider];
    const ingredientName = candidates[0].ingredient?.name ?? "";

    // Alleen kandidaten met een bekende prijs doen mee — een product zonder
    // waarneming is geen prijs van nul.
    const withPrice = candidates.filter((candidate) => latest.has(candidate.id));
    if (withPrice.length === 0) continue;

    const ranked = rankStoreProducts(
      ingredientName,
      withPrice.map(
        (candidate): ProviderProduct => ({
          provider: candidate.provider,
          externalRef: candidate.id,
          name: candidate.name,
          brand: candidate.brand,
          packageSize: candidate.packageSize,
          content:
            candidate.packageQuantity !== null && candidate.ingredient
              ? { amount: candidate.packageQuantity, unit: candidate.ingredient.unit }
              : null,
          price: Number(candidate.price ?? 0),
          wasPrice: null,
          unitPrice: null,
          promoType: "GEEN",
          promoLabel: null,
          promoUntil: null,
          gtin: candidate.gtin,
          labels: [],
          freeFromAllergens: candidate.freeFromAllergens,
          imageId: null,
          url: candidate.productUrl,
        })
      ),
      perProviderLimit
    );
    if (ranked.length === 0) continue;

    const perIngredient = result.get(ingredientId) ?? [];
    for (const match of ranked) {
      const chosen = withPrice.find((candidate) => candidate.id === match.product.externalRef);
      if (!chosen) continue;
      const price = latest.get(chosen.id)!;
      perIngredient.push({
        provider,
        productId: chosen.id,
        name: chosen.name,
        brand: chosen.brand,
        packageSize: chosen.packageSize,
        packageQuantity: chosen.packageQuantity,
        unit: chosen.ingredient?.unit ?? null,
        qualityTier: chosen.qualityTier,
        gtin: chosen.gtin,
        freeFromAllergens: chosen.freeFromAllergens,
        productUrl: displayableProductUrl(chosen.productUrl),
        unitPrice: price.unitPrice,
        unitPriceUnit: price.unitPriceUnit,
        price: price.price,
        wasPrice: price.wasPrice,
        promoLabel: price.promoLabel,
        promoUntil: price.promoUntil,
        observedAt: price.observedAt,
        stale: isPriceStale(price.observedAt, now),
      });
    }
    if (perIngredient.length > 0) result.set(ingredientId, perIngredient);
  }

  return result;
}
