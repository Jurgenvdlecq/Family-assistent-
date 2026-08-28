"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold } from "@/lib/auth";
import { DAY_ENUM, DAY_KEYS, getCurrentWeekStart, type DayKey } from "@/lib/week";
import { isWeekParity, type WeekParity } from "@/domain/week/isoWeek";
import { isDayProfileKey } from "@/domain/meal-planning/dayProfiles";
import { invalidateShoppingList } from "@/lib/shoppingList";

/**
 * Na een ritmewijziging is de al gegenereerde weekplanning van déze week niet
 * meer wat de gebruiker net heeft ingesteld. Hem stilzwijgend laten staan zou
 * betekenen dat een instelling pas volgende week iets doet, zonder dat
 * ergens te zeggen.
 *
 * Alleen weggooien als er nog niets van besteld is: liggen er al producten in
 * het Picnic-mandje, dan zou opnieuw plannen die bestelling ongeldig maken.
 * Dan blijft de week staan en gaat het nieuwe ritme vanzelf in bij de
 * volgende week.
 */
async function replanCurrentWeekIfUntouched(householdId: string): Promise<boolean> {
  const mealPlan = await prisma.mealPlan.findUnique({
    where: { householdId_weekStart: { householdId, weekStart: getCurrentWeekStart() } },
    include: { shoppingList: { include: { lines: { select: { transferredToPicnicAt: true } } } } },
  });
  if (!mealPlan) return false;

  const alreadyOrdered = mealPlan.shoppingList?.lines.some((line) => line.transferredToPicnicAt !== null);
  if (alreadyOrdered) return false;

  await prisma.mealPlan.delete({ where: { id: mealPlan.id } });
  return true;
}

function backToRhythm(status: string, unique: string): never {
  revalidatePath("/ons-gezin");
  revalidatePath("/week");
  revalidatePath("/boodschappen");
  // De unieke waarde in de URL is geen sier: zonder iets wat per actie
  // verschilt komt de redirect uit op exact de pagina waar de gebruiker al
  // staat, en dan slaat de router die navigatie over — de wijziging staat dan
  // wel in de database maar niet op het scherm.
  redirect(`/ons-gezin?status=${encodeURIComponent(status)}&ritme=${encodeURIComponent(unique)}#weekritme`);
}

function parseDayKey(raw: FormDataEntryValue | null): DayKey {
  const value = String(raw ?? "") as DayKey;
  if (!DAY_KEYS.includes(value)) throw new Error("Onbekende dag.");
  return value;
}

function parseParity(raw: FormDataEntryValue | null): WeekParity {
  const value = String(raw ?? "EVERY");
  if (!isWeekParity(value)) throw new Error("Onbekende weeksoort.");
  return value;
}

/**
 * Legt vast wat voor soort avond een weekdag is: welk dagprofiel, en of er een
 * samengestelde maaltijd bij hoort. Eén regel per (dag, weeksoort).
 *
 * Werkt bewust op weekdag + weeksoort uit het formulier en niet op een
 * regel-id: er komt dus geen door de client aangeleverde id in een
 * databaselookup terecht. Het huishouden komt uit de sessie.
 */
export async function saveMealDayRule(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const dayKey = parseDayKey(formData.get("dayKey"));
  const weekParity = parseParity(formData.get("weekParity"));
  const profileKey = String(formData.get("profileKey") ?? "");
  const rawTemplateId = String(formData.get("mealTemplateId") ?? "");

  if (!profileKey) {
    // Geen profiel = geen regel. De planner valt dan terug op de gewone
    // scoring, precies zoals bij een huishouden dat hier nooit iets invulde.
    await prisma.mealDayRule.deleteMany({
      where: { householdId, dayOfWeek: DAY_ENUM[dayKey], weekParity },
    });
    await replanCurrentWeekIfUntouched(householdId);
    backToRhythm("rhythm-cleared", `${dayKey}-${weekParity}`);
  }

  if (!isDayProfileKey(profileKey)) throw new Error("Onbekend dagprofiel.");

  // Het sjabloon moet van dit huishouden zijn — een id uit het formulier mag
  // nooit rechtstreeks een andere huishouding aanwijzen.
  let mealTemplateId: string | null = null;
  if (rawTemplateId) {
    const template = await prisma.mealTemplate.findFirst({
      where: { id: rawTemplateId, householdId },
      select: { id: true },
    });
    if (!template) throw new Error("Onbekend maaltijdsjabloon.");
    mealTemplateId = template.id;
  }

  await prisma.mealDayRule.upsert({
    where: { householdId_dayOfWeek_weekParity: { householdId, dayOfWeek: DAY_ENUM[dayKey], weekParity } },
    create: { householdId, dayOfWeek: DAY_ENUM[dayKey], weekParity, profileKey, mealTemplateId },
    update: { profileKey, mealTemplateId },
  });

  const replanned = await replanCurrentWeekIfUntouched(householdId);
  backToRhythm(replanned ? "rhythm-saved-replanned" : "rhythm-saved", `${dayKey}-${weekParity}`);
}

/**
 * Wie er op een bepaalde weekdag mee-eet, eventueel alleen in oneven of even
 * weken.
 *
 * Slaat alleen de afwijkingen van `defaultPresent` op, net als de bestaande
 * aanwezigheidsknoppen — zo blijft "iedereen eet gewoon mee" ook echt leeg in
 * de database in plaats van zeven keer expliciet vastgelegd.
 */
export async function saveDayPresence(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const dayKey = parseDayKey(formData.get("dayKey"));
  const weekParity = parseParity(formData.get("weekParity"));
  const presentIds = new Set(formData.getAll("presentPersonId").map(String));

  const persons = await prisma.person.findMany({
    where: { householdId },
    select: { id: true, defaultPresent: true },
  });

  for (const person of persons) {
    const present = presentIds.has(person.id);
    if (present === person.defaultPresent) {
      await prisma.personPresenceOverride.deleteMany({
        where: { personId: person.id, dayOfWeek: DAY_ENUM[dayKey], weekParity },
      });
      continue;
    }
    await prisma.personPresenceOverride.upsert({
      where: {
        personId_dayOfWeek_weekParity: { personId: person.id, dayOfWeek: DAY_ENUM[dayKey], weekParity },
      },
      create: { personId: person.id, dayOfWeek: DAY_ENUM[dayKey], weekParity, present },
      update: { present },
    });
  }

  // Andere aanwezigheid betekent andere hoeveelheden op de lijst van deze week.
  const mealPlan = await prisma.mealPlan.findUnique({
    where: { householdId_weekStart: { householdId, weekStart: getCurrentWeekStart() } },
    select: { id: true },
  });
  if (mealPlan) await invalidateShoppingList(mealPlan.id, { keepListRow: true });

  backToRhythm("presence-saved", `${dayKey}-${weekParity}`);
}
