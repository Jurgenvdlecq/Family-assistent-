import { weekParityForDate, type WeekParity } from "@/domain/week/isoWeek";

/**
 * Minimale vorm van een dagregel — bewust structureel en niet het volledige
 * Prisma-type, zodat deze keuze zonder database te testen is.
 */
export interface MealDayRuleLike {
  dayOfWeek: string;
  weekParity: WeekParity;
}

/**
 * Welke dagregel geldt er op deze concrete datum?
 *
 * Zelfde volgorde als bij aanwezigheid: eerst de regel voor de weeksoort van
 * díé week (oneven/even), dan de regel die elke week geldt. Zo kan een
 * huishouden "vrijdag is meestal een gezinsavond, maar in even weken eten we
 * met z'n tweeën" zeggen zonder beide gevallen volledig uit te hoeven
 * schrijven.
 *
 * Geeft `null` als er niets is ingesteld — dan blijft de planner zich
 * gedragen zoals vóór het weekritme.
 */
export function resolveMealDayRule<T extends MealDayRuleLike>(
  rules: T[],
  dayOfWeek: string,
  date: Date
): T | null {
  const forDay = rules.filter((rule) => rule.dayOfWeek === dayOfWeek);
  const parity = weekParityForDate(date);
  return (
    forDay.find((rule) => rule.weekParity === parity) ??
    forDay.find((rule) => rule.weekParity === "EVERY") ??
    null
  );
}
