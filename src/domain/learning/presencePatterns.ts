import type { DayOfWeek } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { patternConfidence } from "./patterns";

/**
 * Leren van herhaalde aanwezigheidscorrecties.
 *
 * De regel uit de opdracht, en tegelijk de veilige kant: een correctie voor
 * één datum verandert het weekritme **nooit** vanzelf. Eén afwijkende vrijdag
 * betekent niet dat vrijdag voortaan anders is. Pas als dezelfde correctie
 * zich een paar keer herhaalt mag de app ernaar vrágen — en dan is het nog
 * steeds de gebruiker die het patroon wijzigt.
 *
 * Waarom drie keer: twee keer kan toeval zijn (een weekend weg, een keer
 * sporten). Drie keer dezelfde correctie op dezelfde weekdag is een gewoonte.
 * Dezelfde drempel als de bestaande maaltijdpatronen, zodat de app niet op de
 * ene plek doordrammerig en op de andere plek zwijgzaam is.
 */
const PROMPT_THRESHOLD = 3;

export interface PresenceObservation {
  householdId: string;
  personId: string;
  personName: string;
  dayOfWeek: DayOfWeek;
  /** Wat de gebruiker voor die ene datum instelde. */
  present: boolean;
}

/**
 * De sleutel bevat bewust ook `present`: "Kai eet woensdag tóch mee" en "Kai
 * eet woensdag juist niet mee" zijn twee verschillende gewoontes, en het zou
 * onzin zijn om ze bij elkaar op te tellen tot één patroon.
 */
function contextKeyFor(observation: PresenceObservation) {
  return `day:${observation.dayOfWeek}:present:${observation.present}`;
}

/**
 * Legt één correctie vast en maakt een leervraag zodra dezelfde correctie zich
 * vaak genoeg herhaald heeft. Geeft terug of er een nieuwe vraag ontstond —
 * puur zodat de aanroeper dat kan loggen; de app vraagt het vanzelf op het
 * weekscherm.
 */
export async function recordPresenceCorrection(observation: PresenceObservation): Promise<boolean> {
  const contextKey = contextKeyFor(observation);
  const existing = await prisma.learnedPattern.findFirst({
    where: {
      householdId: observation.householdId,
      patternType: "PRESENCE_CHANGED_ON_DAY",
      subjectType: null,
      subjectId: observation.personId,
      contextKey,
    },
    select: { id: true, evidenceCount: true, status: true },
  });

  // Een patroon dat de gebruiker al heeft afgewezen komt niet terug: dan is
  // "nee" een antwoord en geen uitnodiging om het nog eens te vragen.
  if (existing?.status === "DISMISSED") return false;

  const evidenceCount = (existing?.evidenceCount ?? 0) + 1;
  const context = {
    dayOfWeek: observation.dayOfWeek,
    personId: observation.personId,
    personName: observation.personName,
    present: observation.present,
  };

  const pattern = existing
    ? await prisma.learnedPattern.update({
        where: { id: existing.id },
        data: {
          evidenceCount,
          confidence: patternConfidence(evidenceCount),
          lastObservedAt: new Date(),
          context,
        },
      })
    : await prisma.learnedPattern.create({
        data: {
          householdId: observation.householdId,
          patternType: "PRESENCE_CHANGED_ON_DAY",
          subjectId: observation.personId,
          contextKey,
          evidenceCount,
          confidence: patternConfidence(evidenceCount),
          context,
        },
      });

  if (evidenceCount < PROMPT_THRESHOLD || pattern.status === "CONFIRMED") return false;

  // Niet twee keer dezelfde vraag stellen zolang de eerste nog openstaat.
  const openPrompt = await prisma.learningPrompt.findFirst({
    where: { householdId: observation.householdId, learnedPatternId: pattern.id, status: "PENDING" },
    select: { id: true },
  });
  if (openPrompt) return false;

  await prisma.learningPrompt.create({
    data: {
      householdId: observation.householdId,
      learnedPatternId: pattern.id,
      promptType: "CONFIRM_PRESENCE_PATTERN",
      trigger: contextKey,
      payload: { evidenceCount },
    },
  });
  return true;
}

const DAY_LABELS: Record<string, string> = {
  MONDAY: "maandag",
  TUESDAY: "dinsdag",
  WEDNESDAY: "woensdag",
  THURSDAY: "donderdag",
  FRIDAY: "vrijdag",
  SATURDAY: "zaterdag",
  SUNDAY: "zondag",
};

export function describePresencePrompt(context: unknown, evidenceCount: number): string {
  const value = (context ?? {}) as { personName?: string; dayOfWeek?: string; present?: boolean };
  const person = value.personName ?? "iemand";
  const day = DAY_LABELS[value.dayOfWeek ?? ""] ?? "die dag";
  const what = value.present ? "juist wél mee" : "niet mee";
  return `De afgelopen ${evidenceCount} keer at ${person} op ${day} ${what}. Zal ik dat zo in jullie weekritme zetten?`;
}

/**
 * Maakt het geleerde patroon tot het nieuwe verwachte ritme — alleen op
 * uitdrukkelijk "ja" van de gebruiker.
 *
 * Schrijft naar de regel die élke week geldt: dit gaat over een gewoonte, niet
 * over oneven of even weken. Wisselt het per week, dan stelt de gebruiker dat
 * zelf in bij Ons gezin; dat automatisch afleiden zou te veel geraden zijn.
 */
export async function applyPresencePattern(householdId: string, promptId: string) {
  const prompt = await prisma.learningPrompt.findFirstOrThrow({
    where: { id: promptId, householdId, promptType: "CONFIRM_PRESENCE_PATTERN" },
    include: { learnedPattern: true },
  });
  const context = (prompt.learnedPattern?.context ?? {}) as {
    personId?: string;
    dayOfWeek?: DayOfWeek;
    present?: boolean;
  };
  if (!context.personId || !context.dayOfWeek || typeof context.present !== "boolean") {
    throw new Error("Dit patroon mist gegevens om toe te passen.");
  }

  // Nog één keer controleren dat de persoon van dít huishouden is — het
  // patroon komt uit de database, maar de koppeling is niet afgedwongen.
  const person = await prisma.person.findFirst({
    where: { id: context.personId, householdId },
    select: { id: true, defaultPresent: true },
  });
  if (!person) throw new Error("Onbekend gezinslid.");

  if (context.present === person.defaultPresent) {
    await prisma.personPresenceOverride.deleteMany({
      where: { personId: person.id, dayOfWeek: context.dayOfWeek, weekParity: "EVERY" },
    });
  } else {
    await prisma.personPresenceOverride.upsert({
      where: {
        personId_dayOfWeek_weekParity: {
          personId: person.id,
          dayOfWeek: context.dayOfWeek,
          weekParity: "EVERY",
        },
      },
      create: {
        personId: person.id,
        dayOfWeek: context.dayOfWeek,
        weekParity: "EVERY",
        present: context.present,
      },
      update: { present: context.present },
    });
  }

  await prisma.$transaction([
    prisma.learningPrompt.update({
      where: { id: prompt.id },
      data: { status: "ANSWERED", answeredAt: new Date(), payload: { ...(prompt.payload as object), applied: true } },
    }),
    ...(prompt.learnedPatternId
      ? [
          prisma.learnedPattern.update({
            where: { id: prompt.learnedPatternId },
            data: { status: "CONFIRMED", confidence: 0.9 },
          }),
        ]
      : []),
  ]);
}
