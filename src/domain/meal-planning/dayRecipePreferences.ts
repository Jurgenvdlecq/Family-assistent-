import type { DayKey } from "@/lib/week";

export const DAY_RECIPE_PREFERENCE_STANCES = ["LIKED", "SOMETIMES", "RATHER_NOT"] as const;

export type DayRecipePreferenceStance = (typeof DAY_RECIPE_PREFERENCE_STANCES)[number];

export function dayRecipePreferenceOwnerId(householdId: string, dayKey: DayKey) {
  return `${householdId}:day:${dayKey}`;
}

export function isDayRecipePreferenceStance(value: string): value is DayRecipePreferenceStance {
  return DAY_RECIPE_PREFERENCE_STANCES.includes(value as DayRecipePreferenceStance);
}
