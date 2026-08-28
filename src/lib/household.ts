import { prisma } from "./prisma";
import { DAY_KEYS, dateForDay, getCurrentWeekStart, type DayKey } from "./week";
import {
  calculatePortionScaleByDay,
  calculatePortionScaleForDate,
  calculatePortionScaleForWeek,
  getPresentPersonsForDate,
  getPresentPersonsForDay,
  getPresentPersonsForWeek,
  type DayPortionScale,
  type PersonPresenceInput,
} from "@/domain/household/presence";

/**
 * Hoe ver terug datum-uitzonderingen worden meegeladen.
 *
 * De planner en de boodschappenlijst kijken alleen vooruit; een uitzondering
 * van vorige maand doet daar niets meer. Zonder deze grens zou elke
 * berekening de hele geschiedenis van uitzonderingen meeslepen, die alleen
 * maar groeit. Twee weken marge is ruim genoeg voor de lopende week plus de
 * week ervoor (geschiedenis op /week).
 */
const DATE_OVERRIDE_LOOKBACK_DAYS = 14;

function dateOverrideCutoff(reference: Date = new Date()): Date {
  const cutoff = new Date(reference);
  cutoff.setDate(cutoff.getDate() - DATE_OVERRIDE_LOOKBACK_DAYS);
  cutoff.setHours(0, 0, 0, 0);
  return cutoff;
}

export async function getHouseholdPersonsForMeals(householdId: string): Promise<PersonPresenceInput[]> {
  return prisma.person.findMany({
    where: { householdId },
    select: {
      id: true,
      name: true,
      defaultPresent: true,
      portionMultiplier: true,
      hardRestrictions: true,
      presenceOverrides: { select: { dayOfWeek: true, present: true, weekParity: true } },
      presenceDateOverrides: {
        where: { date: { gte: dateOverrideCutoff() } },
        select: { date: true, present: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

function parseRestrictionsArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Combineert de harde beperkingen van aanwezige gezinsleden mét de
 * huishoudbrede regel (MEAL_PLANNING_GAP_PLAN.md, wens 2: "geen vis"). Die
 * laatste geldt bewust altijd, ongeacht wie er die dag mee-eet — het is geen
 * allergie van een specifiek persoon maar een gezinskeuze.
 */
function collectHardRestrictions(persons: PersonPresenceInput[], householdRestrictions: unknown): string[] {
  const combined: string[] = [...parseRestrictionsArray(householdRestrictions)];
  for (const person of persons) {
    combined.push(...parseRestrictionsArray(person.hardRestrictions));
  }
  return [...new Set(combined.map((item) => item.trim()).filter(Boolean))];
}

/**
 * Alle harde beperkingen van gezinsleden die op deze dag mee-eten, plus de
 * huishoudbrede regel. Allergieën en "nooit"-regels worden hiermee vroeg
 * gefilterd en dus niet als gewone negatieve voorkeur behandeld.
 */
export async function getHouseholdHardRestrictions(
  householdId: string,
  dayKey?: DayKey
): Promise<string[]> {
  const [persons, household] = await Promise.all([
    getHouseholdPersonsForMeals(householdId),
    prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: { hardRestrictions: true } }),
  ]);
  const presentPersons = dayKey
    ? getPresentPersonsForDay(persons, dayKey)
    : persons.filter((person) => person.defaultPresent);
  return collectHardRestrictions(presentPersons, household.hardRestrictions);
}

export async function getHouseholdPortionScaleByDay(
  householdId: string
): Promise<Record<DayKey, DayPortionScale>> {
  const persons = await getHouseholdPersonsForMeals(householdId);
  return calculatePortionScaleByDay(persons);
}

/**
 * Portieschaling voor een willekeurige datum, als functie in plaats van als
 * tabel per weekdag.
 *
 * Waarom een functie: de boodschappenlijst rekent aan avonden uit twee
 * verschillende weken tegelijk (bezorging zaterdag, koken dinsdag daarna).
 * Die twee weken hebben altijd een verschillende oneven/even-pariteit, dus
 * "de schaal van dinsdag" bestaat niet — alleen "de schaal van dinsdag 8
 * september". De personen worden één keer geladen; de functie zelf raakt de
 * database niet meer.
 */
export type PortionScaleForDate = (date: Date) => DayPortionScale;

export async function getHouseholdPortionScaleForDate(
  householdId: string
): Promise<PortionScaleForDate> {
  const persons = await getHouseholdPersonsForMeals(householdId);
  return (date: Date) => calculatePortionScaleForDate(persons, date);
}

/** Wie er mee-eet op elke dag van één concrete week (pariteit- en uitzonderingsbewust). */
export async function getHouseholdMealParticipantsForWeek(householdId: string, weekStart: Date) {
  const persons = await getHouseholdPersonsForMeals(householdId);
  return getPresentPersonsForWeek(persons, weekStart);
}

/**
 * Fase 13: combineert harde beperkingen + aanwezigheid per dag in één
 * `person.findMany` — de aanroepers die beide nodig hebben (mealPlan.ts,
 * /gerechten) deden voorheen `getHouseholdHardRestrictions(dayKey)` per dag
 * én de deelnemers los aan, wat dezelfde personendata tot 8x per aanroep
 * opnieuw uit de database haalde zonder dat er tussentijds iets veranderde.
 *
 * Neemt sinds het weekritme een `weekStart` aan: wie er mee-eet hangt af van
 * de concrete datum (oneven/even-ritme, datum-uitzonderingen), niet alleen
 * van de weekdag. Aanroepers die "deze week" bedoelen geven
 * `getCurrentWeekStart()` mee — expliciet, zodat nooit onduidelijk is welke
 * week er bedoeld wordt.
 */
export async function getHouseholdHardRestrictionsAndParticipantsForWeek(
  householdId: string,
  weekStart: Date = getCurrentWeekStart()
): Promise<{
  hardRestrictionsByDay: Record<DayKey, string[]>;
  participantsByDay: Record<DayKey, PersonPresenceInput[]>;
}> {
  const [persons, household] = await Promise.all([
    getHouseholdPersonsForMeals(householdId),
    prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: { hardRestrictions: true } }),
  ]);
  const participantsByDay = Object.fromEntries(
    DAY_KEYS.map((dayKey) => [dayKey, getPresentPersonsForDate(persons, dateForDay(weekStart, dayKey))])
  ) as Record<DayKey, PersonPresenceInput[]>;
  const hardRestrictionsByDay = Object.fromEntries(
    DAY_KEYS.map((dayKey) => [dayKey, collectHardRestrictions(participantsByDay[dayKey], household.hardRestrictions)])
  ) as Record<DayKey, string[]>;
  return { hardRestrictionsByDay, participantsByDay };
}

/** Portieschaling voor elke dag van één concrete week. */
export async function getHouseholdPortionScaleForWeek(
  householdId: string,
  weekStart: Date
): Promise<Record<DayKey, DayPortionScale>> {
  const persons = await getHouseholdPersonsForMeals(householdId);
  return calculatePortionScaleForWeek(persons, weekStart);
}
