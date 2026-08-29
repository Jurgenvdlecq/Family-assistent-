import type { ProductProvider } from "@/generated/prisma/enums";
import { judgeDiscount } from "@/domain/pricing/priceHistory";
import { parsePromoMechanism, promotionIsActive, applyPromotion } from "@/domain/pricing/promotions";
import { PROVIDER_LABELS } from "@/domain/pricing/types";
import { getPriceHistories } from "./observations";
import { getStorePricesForIngredients, type StorePriceForIngredient } from "./storePrices";

/**
 * Welke ingrediënten zijn deze week écht in de actie?
 *
 * Gebruikt door de weekplanning (een aanbieding mag meewegen bij het kiezen
 * van een gerecht) en door de attentie op de boodschappenlijst.
 *
 * "Écht" doet hier het werk. Drie filters, en alle drie zijn ze er om te
 * voorkomen dat dit een reclamebalk wordt:
 *
 * 1. De actie moet nog lopen.
 * 2. De van-prijs moet volgens de prijsgeschiedenis kloppen — een van-prijs
 *    die hier nooit gerekend is, is geen korting (zie `judgeDiscount`).
 * 3. Er moet daadwerkelijk geld mee bespaard worden. "1+1 gratis" op iets
 *    waarvan je er één nodig hebt, levert niets op.
 */

export interface IngredientOffer {
  ingredientId: string;
  label: string;
  storeLabel: string;
  provider: ProductProvider;
  promoLabel: string;
}

export async function getIngredientsOnOffer(
  ingredientIds: string[],
  ingredientNames: Map<string, string>,
  providers: ProductProvider[],
  now: Date = new Date()
): Promise<Map<string, IngredientOffer>> {
  const offers = new Map<string, IngredientOffer>();
  if (ingredientIds.length === 0 || providers.length === 0) return offers;

  const prices = await getStorePricesForIngredients(ingredientIds, providers, now);

  // Alleen waar een actie op staat hoeven we de geschiedenis voor op te halen.
  const candidates: Array<{ ingredientId: string; store: StorePriceForIngredient }> = [];
  for (const [ingredientId, perProvider] of prices) {
    for (const store of perProvider.values()) {
      if (!store.promoLabel) continue;
      if (!promotionIsActive(store.promoUntil, now)) continue;
      candidates.push({ ingredientId, store });
    }
  }
  if (candidates.length === 0) return offers;

  const histories = await getPriceHistories(candidates.map((entry) => entry.store.productId));

  for (const { ingredientId, store } of candidates) {
    // Een van-prijs die de geschiedenis tegenspreekt is geen aanbieding.
    const verdict = judgeDiscount(
      { price: store.price, wasPrice: store.wasPrice, observedAt: store.observedAt },
      histories.get(store.productId) ?? [],
      now
    );
    if (verdict.kind === "NEPKORTING") continue;

    // Levert het mechanisme bij twee stuks iets op? Zo niet, dan is het geen
    // aanbieding maar een bordje. Twee is bewust de maat: bij één stuk levert
    // "1+1 gratis" nooit iets op, en dan zou élke actie wegvallen.
    const mechanism = parsePromoMechanism(store.promoLabel);
    const outcome = applyPromotion(2, store.price, mechanism);
    const savesSomething =
      outcome.costWithoutPromo - outcome.cost >= 0.01 || (store.wasPrice !== null && store.wasPrice > store.price);
    if (!savesSomething) continue;

    // Eén aanbieding per ingrediënt is genoeg voor een reden op het scherm.
    if (offers.has(ingredientId)) continue;
    offers.set(ingredientId, {
      ingredientId,
      label: ingredientNames.get(ingredientId) ?? store.name,
      storeLabel: PROVIDER_LABELS[store.provider],
      provider: store.provider,
      promoLabel: store.promoLabel!,
    });
  }

  return offers;
}
