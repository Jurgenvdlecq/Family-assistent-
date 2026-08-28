import { DAY_ENUM, DAY_KEYS, dateForDay, dayKeyForDate, type DayKey } from "@/lib/week";
import {
  calendarDateKey,
  calendarDateKeyFromColumn,
  weekParityForDate,
  type WeekParity,
} from "@/domain/week/isoWeek";

type DayOfWeekValue = (typeof DAY_ENUM)[DayKey];

export type PresenceOverrideInput = {
  dayOfWeek: DayOfWeekValue;
  present: boolean;
  /** Ontbreekt bij oudere aanroepers/fixtures; dat betekent "elke week". */
  weekParity?: WeekParity;
};

export type PresenceDateOverrideInput = {
  date: Date;
  present: boolean;
};

export type PersonPresenceInput = {
  id: string;
  name: string;
  defaultPresent: boolean;
  portionMultiplier: number;
  hardRestrictions?: unknown;
  presenceOverrides: PresenceOverrideInput[];
  /** Uitzonderingen voor één concrete datum. Ontbreekt bij aanroepers die geen datum kennen. */
  presenceDateOverrides?: PresenceDateOverrideInput[];
};

export type DayPortionScale = {
  scale: number;
  presentPortions: number;
  defaultPortions: number;
  presentPersonNames: string[];
  /**
   * Porties per aanwezige persoon. Nodig voor een avond waarop niet iedereen
   * hetzelfde eet: dan hangt de hoeveelheid af van wíé er bij welk deel hoort,
   * niet van het totaal.
   */
  personPortions: Map<string, number>;
};

function safePortionMultiplier(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function parityOf(override: PresenceOverrideInput): WeekParity {
  return override.weekParity ?? "EVERY";
}

/**
 * Eet deze persoon mee op deze concrete datum?
 *
 * Van specifiek naar algemeen, precies de volgorde uit het schema:
 *   1. een uitzondering voor die datum,
 *   2. het patroon voor de pariteit van die ISO-week (oneven/even),
 *   3. het patroon dat elke week geldt,
 *   4. `defaultPresent`.
 *
 * Stap 1 verandert nooit iets aan stap 2 of 3 — een afwijkende vrijdag maakt
 * vrijdag niet blijvend anders.
 */
export function isPersonPresentOnDate(person: PersonPresenceInput, date: Date): boolean {
  const dateKey = calendarDateKey(date);
  // De opgeslagen datum komt uit een `@db.Date`-kolom (middernacht UTC) en de
  // gevraagde datum is door de app uitgerekend (lokale middernacht) — die twee
  // moeten dus elk met hun eigen lezer naar een kalenderdag.
  const dateOverride = (person.presenceDateOverrides ?? []).find(
    (item) => calendarDateKeyFromColumn(item.date) === dateKey
  );
  if (dateOverride) return dateOverride.present;

  const dayOfWeek = DAY_ENUM[dayKeyForDate(date)];
  const parity = weekParityForDate(date);
  const candidates = person.presenceOverrides.filter((item) => item.dayOfWeek === dayOfWeek);

  const parityMatch = candidates.find((item) => parityOf(item) === parity);
  if (parityMatch) return parityMatch.present;

  const everyWeek = candidates.find((item) => parityOf(item) === "EVERY");
  if (everyWeek) return everyWeek.present;

  return person.defaultPresent;
}

/**
 * Aanwezigheid zonder dat er een datum bekend is: alleen het patroon dat élke
 * week geldt. Voor schermen die het verwachte ritme tonen (zoals de
 * aanwezigheidsknoppen op /ons-gezin), niet voor berekeningen waar een
 * concrete week bij hoort — daar hoort `isPersonPresentOnDate`.
 */
export function isPersonPresentOnDay(person: PersonPresenceInput, dayKey: DayKey): boolean {
  const override = person.presenceOverrides.find(
    (item) => item.dayOfWeek === DAY_ENUM[dayKey] && parityOf(item) === "EVERY"
  );
  return override?.present ?? person.defaultPresent;
}

export function getPresentPersonsForDay(
  persons: PersonPresenceInput[],
  dayKey: DayKey
): PersonPresenceInput[] {
  return persons.filter((person) => isPersonPresentOnDay(person, dayKey));
}

export function getPresentPersonsForDate(
  persons: PersonPresenceInput[],
  date: Date
): PersonPresenceInput[] {
  return persons.filter((person) => isPersonPresentOnDate(person, date));
}

/**
 * De basis waar de schaal tegen afgezet wordt: de porties van iedereen die
 * standaard mee-eet. Bewust datum-onafhankelijk — recepten zijn geschreven
 * voor "het hele gezin", dus die noemer mag niet meebewegen met de week,
 * anders zou dezelfde maaltijd in een even week ineens meer ingrediënten
 * vragen dan in een oneven week.
 */
function baselinePortions(persons: PersonPresenceInput[]): number {
  return persons
    .filter((person) => person.defaultPresent)
    .reduce((sum, person) => sum + safePortionMultiplier(person.portionMultiplier), 0);
}

function portionScaleFor(
  persons: PersonPresenceInput[],
  presentPersons: PersonPresenceInput[]
): DayPortionScale {
  const defaultPortions = baselinePortions(persons);
  const presentPortions = presentPersons.reduce(
    (sum, person) => sum + safePortionMultiplier(person.portionMultiplier),
    0
  );
  const baseline = defaultPortions > 0 ? defaultPortions : presentPortions;

  return {
    scale: baseline > 0 ? presentPortions / baseline : 1,
    presentPortions,
    defaultPortions: baseline > 0 ? baseline : 1,
    presentPersonNames: presentPersons.map((person) => person.name),
    personPortions: new Map(
      presentPersons.map((person) => [person.id, safePortionMultiplier(person.portionMultiplier)])
    ),
  };
}

export function calculatePortionScaleForDay(
  persons: PersonPresenceInput[],
  dayKey: DayKey
): DayPortionScale {
  return portionScaleFor(persons, getPresentPersonsForDay(persons, dayKey));
}

/**
 * Portieschaling voor één concrete datum — inclusief oneven/even-ritme en
 * datum-uitzonderingen.
 *
 * Dit is de variant die de boodschappenlijst moet gebruiken: die beslaat
 * sinds de dagkeuze twee weken, en die twee weken hebben per definitie een
 * verschillende pariteit. Schalen op alleen de weekdag zou de avonden van de
 * volgende week met de aanwezigheid van déze week uitrekenen.
 */
export function calculatePortionScaleForDate(
  persons: PersonPresenceInput[],
  date: Date
): DayPortionScale {
  return portionScaleFor(persons, getPresentPersonsForDate(persons, date));
}

export function calculatePortionScaleByDay(
  persons: PersonPresenceInput[]
): Record<DayKey, DayPortionScale> {
  return Object.fromEntries(
    DAY_KEYS.map((dayKey) => [dayKey, calculatePortionScaleForDay(persons, dayKey)])
  ) as Record<DayKey, DayPortionScale>;
}

/**
 * Portieschaling voor elke dag van één concrete week. Zelfde vorm als
 * `calculatePortionScaleByDay`, maar met de datums van díé week erbij — dus
 * pariteit- en uitzonderingsbewust.
 */
export function calculatePortionScaleForWeek(
  persons: PersonPresenceInput[],
  weekStart: Date
): Record<DayKey, DayPortionScale> {
  return Object.fromEntries(
    DAY_KEYS.map((dayKey) => [dayKey, calculatePortionScaleForDate(persons, dateForDay(weekStart, dayKey))])
  ) as Record<DayKey, DayPortionScale>;
}

export function getPresentPersonsForWeek(
  persons: PersonPresenceInput[],
  weekStart: Date
): Record<DayKey, PersonPresenceInput[]> {
  return Object.fromEntries(
    DAY_KEYS.map((dayKey) => [dayKey, getPresentPersonsForDate(persons, dateForDay(weekStart, dayKey))])
  ) as Record<DayKey, PersonPresenceInput[]>;
}

export function defaultPortionMultiplierForRole(role: "PARENT" | "CHILD" | "OTHER"): number {
  return role === "CHILD" ? 0.7 : 1;
}
