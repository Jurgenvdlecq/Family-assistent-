import { prisma } from "./prisma";
import type { DayKey } from "./week";
import {
  calculatePortionScaleByDay,
  getPresentPersonsForDay,
  type DayPortionScale,
  type PersonPresenceInput,
} from "@/domain/household/presence";

async function getHouseholdPersonsForMeals(householdId: string): Promise<PersonPresenceInput[]> {
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
