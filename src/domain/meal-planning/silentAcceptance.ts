import type { DayOfWeek, MealPlanEntrySource, MealPlanEntryStatus } from "@/generated/prisma/enums";

export interface SilentAcceptanceEntry {
  id: string;
  dayOfWeek: DayOfWeek;
  recipeVariantId: string;
  source: MealPlanEntrySource;
  status: MealPlanEntryStatus;
  /** Huishouden eet deze dag niet thuis — geen feedback/geleerd patroon voor een maaltijd die nooit gekookt is. */
  skipped: boolean;
}

/**
 * "Stilte is feedback", maar voorzichtig: alleen app-voorstellen die nog
 * PROPOSED zijn krijgen een zachte acceptatie. Handmatige/assistent-keuzes
 * zijn al expliciet gekozen en tellen hier dus niet nogmaals mee. Een
 * overgeslagen dag (uit eten) telt nooit mee, ongeacht status/source —
 * anders zou "stilte" ten onrechte als "lekker gevonden" worden uitgelegd.
 */
export function entriesForSilentAcceptance<T extends SilentAcceptanceEntry>(entries: T[]): T[] {
  return entries.filter(
    (entry) =>
      !entry.skipped &&
      entry.status === "PROPOSED" &&
      (entry.source === "AUTO" || entry.source === "REGENERATED")
  );
}
