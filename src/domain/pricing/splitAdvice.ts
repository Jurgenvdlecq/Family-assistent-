import type { ProductProvider } from "@/generated/prisma/enums";
import { countsAsHardMatch } from "./equivalence";
import type { BasketComparison } from "./basketComparison";

/**
 * Loont het om de boodschappen te splitsen?
 *
 * De eerlijke versie van "bij Dirk ben je goedkoper uit": splitsen kost een
 * extra rit of een tweede bestelling, dus een paar dubbeltjes verschil is geen
 * advies maar ruis. Onder de drempel zegt de app daarom niets.
 *
 * Twee dingen die dit advies bewust *niet* doet:
 * - het rekent alleen met producten die identiek of gelijkwaardig zijn. Een
 *   "besparing" die je krijgt door iets anders te kopen is geen besparing;
 * - het belooft geen totaalbedrag voor de hele lijst. Het zegt precies welke
 *   producten het betreft en wat díé schelen.
 */

/**
 * Onder dit bedrag zwijgen we.
 *
 * Bewust aan de hoge kant: de moeite van een tweede winkel (een rit, of een
 * tweede bestelling met eigen bezorgkosten en minimumbedrag) verdient meer dan
 * een paar dubbeltjes. Nog open in de opdracht: of Dirk bij ons bezorgt of dat
 * het zelf halen is — dat bepaalt uiteindelijk waar deze drempel hoort te
 * liggen. Tot dat bekend is, is dit een bewust conservatieve waarde.
 */
export const SPLIT_ADVICE_THRESHOLD = 5;

export interface SplitAdviceItem {
  lineId: string;
  ingredientName: string;
  productName: string;
  ownCost: number;
  storeCost: number;
  saving: number;
}

export interface SplitAdvice {
  provider: ProductProvider;
  items: SplitAdviceItem[];
  totalSaving: number;
}

/**
 * Welke producten zou je bij welke winkel moeten halen, en wat scheelt dat?
 *
 * Levert een lege lijst zolang het de moeite niet is. Dat is het hele punt:
 * een advies dat elke week verschijnt met een besparing van € 0,40 leert de
 * gebruiker het te negeren.
 */
export function buildSplitAdvice(
  comparison: BasketComparison,
  options?: { threshold?: number }
): SplitAdvice[] {
  const threshold = options?.threshold ?? SPLIT_ADVICE_THRESHOLD;
  const byProvider = new Map<ProductProvider, SplitAdviceItem[]>();

  for (const line of comparison.lines) {
    // Zonder eigen prijs valt er niets te vergelijken, en dus ook niets te
    // adviseren.
    if (line.referenceCost === null) continue;

    for (const store of line.stores.values()) {
      if (store.cost === null) continue;
      // Alleen hetzelfde of gelijkwaardig. Goedkoper door iets anders te
      // kopen is geen besparing.
      if (!countsAsHardMatch(store.level)) continue;

      const saving = Number((line.referenceCost - store.cost).toFixed(2));
      if (saving < 0.01) continue;

      const items = byProvider.get(store.provider) ?? [];
      items.push({
        lineId: line.lineId,
        ingredientName: line.ingredientName,
        productName: store.name,
        ownCost: line.referenceCost,
        storeCost: store.cost,
        saving,
      });
      byProvider.set(store.provider, items);
    }
  }

  return [...byProvider.entries()]
    .map(([provider, items]) => ({
      provider,
      items: [...items].sort((a, b) => b.saving - a.saving || a.lineId.localeCompare(b.lineId)),
      totalSaving: Number(items.reduce((sum, item) => sum + item.saving, 0).toFixed(2)),
    }))
    .filter((advice) => advice.totalSaving >= threshold)
    .sort((a, b) => b.totalSaving - a.totalSaving);
}

/** Het advies in gewone taal, of `null` als er niets te adviseren valt. */
export function describeSplitAdvice(advice: SplitAdvice, storeLabel: string): string {
  const count = advice.items.length;
  return `Deze ${count} ${count === 1 ? "product" : "producten"} bij ${storeLabel} halen scheelt € ${advice.totalSaving
    .toFixed(2)
    .replace(".", ",")} — dat is dan wel een tweede winkel.`;
}
