import type { DayOfWeek, MealPlanEntrySource, MealPlanEntryStatus } from "@/generated/prisma/enums";

export interface SilentAcceptanceEntry {
  id: string;
  dayOfWeek: DayOfWeek;
  recipeVariantId: string;
  source: MealPlanEntrySource;
  status: MealPlanEntryStatus;
}

/**
 * "Stilte is feedback", maar voorzichtig: alleen app-voorstellen die nog
 * PROPOSED zijn krijgen een zachte acceptatie. Handmatige/assistent-keuzes
 * zijn al expliciet gekozen en tellen hier dus niet nogmaals mee.
 */
export function entriesForSilentAcceptance<T extends SilentAcceptanceEntry>(entries: T[]): T[] {
  return entries.filter(
    (entry) =>
      entry.status === "PROPOSED" &&
      (entry.source === "AUTO" || entry.source === "REGENERATED")
  );
}
