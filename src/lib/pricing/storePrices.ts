import { prisma } from "@/lib/prisma";
import type { ProductProvider, QualityTier, Unit } from "@/generated/prisma/enums";
import { rankStoreProducts } from "@/domain/pricing/storeMatch";
import type { ProviderProduct } from "@/domain/pricing/types";
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
  const result: StorePricesByIngredient = new Map();
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
        })
      ),
      1
    );
    if (ranked.length === 0) continue;

    const chosen = withPrice.find((candidate) => candidate.id === ranked[0].product.externalRef);
    if (!chosen) continue;
    const price = latest.get(chosen.id)!;

    const perIngredient = result.get(ingredientId) ?? new Map<ProductProvider, StorePriceForIngredient>();
    perIngredient.set(provider, {
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
      price: price.price,
      wasPrice: price.wasPrice,
      promoLabel: price.promoLabel,
      promoUntil: price.promoUntil,
      observedAt: price.observedAt,
      stale: isPriceStale(price.observedAt, now),
    });
    result.set(ingredientId, perIngredient);
  }

  return result;
}
