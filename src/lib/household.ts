import { prisma } from "./prisma";
import { DAY_KEYS, type DayKey } from "./week";
import {
  calculatePortionScaleByDay,
  getPresentPersonsForDay,
  type DayPortionScale,
  type PersonPresenceInput,
} from "@/domain/household/presence";

export async function getHouseholdPersonsForMeals(householdId: string): Promise<PersonPresenceInput[]> {
  return prisma.person.findMany({
    where: { householdId },
    select: {
      id: true,
      name: true,
      defaultPresent: true,
      portionMultiplier: true,
      hardRestrictions: true,
      presenceOverrides: { select: { dayOfWeek: true, present: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

function collectHardRestrictions(persons: PersonPresenceInput[]): string[] {
  const combined: string[] = [];
  for (const person of persons) {
    if (Array.isArray(person.hardRestrictions)) {
      combined.push(...(person.hardRestrictions as string[]));
    }
  }
  return [...new Set(combined.map((item) => item.trim()).filter(Boolean))];
}

/**
 * Alle harde beperkingen van gezinsleden die op deze dag mee-eten. Allergieën
 * en "nooit"-regels worden hiermee vroeg gefilterd en dus niet als gewone
 * negatieve voorkeur behandeld.
 */
export async function getHouseholdHardRestrictions(
  householdId: string,
  dayKey?: DayKey
): Promise<string[]> {
  const persons = await getHouseholdPersonsForMeals(householdId);
  const presentPersons = dayKey
    ? getPresentPersonsForDay(persons, dayKey)
    : persons.filter((person) => person.defaultPresent);
  return collectHardRestrictions(presentPersons);
}

export async function getHouseholdPortionScaleByDay(
  householdId: string
): Promise<Record<DayKey, DayPortionScale>> {
  const persons = await getHouseholdPersonsForMeals(householdId);
  return calculatePortionScaleByDay(persons);
}

function deriveParticipantsByDay(persons: PersonPresenceInput[]): Record<DayKey, PersonPresenceInput[]> {
  return Object.fromEntries(
    DAY_KEYS.map((dayKey) => [dayKey, getPresentPersonsForDay(persons, dayKey)])
  ) as Record<DayKey, PersonPresenceInput[]>;
}

export async function getHouseholdMealParticipantsByDay(householdId: string) {
  const persons = await getHouseholdPersonsForMeals(householdId);
  return deriveParticipantsByDay(persons);
}

/**
 * Fase 13: combineert harde beperkingen + aanwezigheid per dag in één
 * `person.findMany` — de aanroepers die beide nodig hebben (mealPlan.ts,
 * /gerechten) deden voorheen `getHouseholdHardRestrictions(dayKey)` per dag
 * én `getHouseholdMealParticipantsByDay()` los aan, wat dezelfde
 * personendata tot 8x per aanroep opnieuw uit de database haalde zonder dat
 * er tussentijds iets veranderde.
 */
export async function getHouseholdHardRestrictionsAndParticipantsByDay(householdId: string): Promise<{
  hardRestrictionsByDay: Record<DayKey, string[]>;
  participantsByDay: Record<DayKey, PersonPresenceInput[]>;
}> {
  const persons = await getHouseholdPersonsForMeals(householdId);
  const participantsByDay = deriveParticipantsByDay(persons);
  const hardRestrictionsByDay = Object.fromEntries(
    DAY_KEYS.map((dayKey) => [dayKey, collectHardRestrictions(participantsByDay[dayKey])])
  ) as Record<DayKey, string[]>;
  return { hardRestrictionsByDay, participantsByDay };
}
