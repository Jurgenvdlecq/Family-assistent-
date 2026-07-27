import { DAY_ENUM, DAY_KEYS, type DayKey } from "@/lib/week";

type DayOfWeekValue = (typeof DAY_ENUM)[DayKey];

export type PresenceOverrideInput = {
  dayOfWeek: DayOfWeekValue;
  present: boolean;
};

export type PersonPresenceInput = {
  id: string;
  name: string;
  defaultPresent: boolean;
  portionMultiplier: number;
  hardRestrictions?: unknown;
  presenceOverrides: PresenceOverrideInput[];
};

export type DayPortionScale = {
  scale: number;
  presentPortions: number;
  defaultPortions: number;
  presentPersonNames: string[];
};

function safePortionMultiplier(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function isPersonPresentOnDay(person: PersonPresenceInput, dayKey: DayKey): boolean {
  const override = person.presenceOverrides.find((item) => item.dayOfWeek === DAY_ENUM[dayKey]);
  return override?.present ?? person.defaultPresent;
}

export function getPresentPersonsForDay(
  persons: PersonPresenceInput[],
  dayKey: DayKey
): PersonPresenceInput[] {
  return persons.filter((person) => isPersonPresentOnDay(person, dayKey));
}

export function calculatePortionScaleForDay(
  persons: PersonPresenceInput[],
  dayKey: DayKey
): DayPortionScale {
  const defaultPortions = persons
    .filter((person) => person.defaultPresent)
    .reduce((sum, person) => sum + safePortionMultiplier(person.portionMultiplier), 0);
  const presentPersons = getPresentPersonsForDay(persons, dayKey);
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
  };
}

export function calculatePortionScaleByDay(
  persons: PersonPresenceInput[]
): Record<DayKey, DayPortionScale> {
  return Object.fromEntries(
    DAY_KEYS.map((dayKey) => [dayKey, calculatePortionScaleForDay(persons, dayKey)])
  ) as Record<DayKey, DayPortionScale>;
}

export function defaultPortionMultiplierForRole(role: "PARENT" | "CHILD" | "OTHER"): number {
  return role === "CHILD" ? 0.7 : 1;
}
