"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold } from "@/lib/auth";
import { invalidateShoppingList } from "@/lib/shoppingList";
import { getCurrentWeekStart } from "@/lib/week";
import { dayKeyForDate, parseOrderDate } from "@/lib/orderDays";
import { toCalendarDate } from "@/domain/week/isoWeek";
import { DAY_ENUM } from "@/lib/week";
import { isPersonPresentOnDate } from "@/domain/household/presence";
import { applyPresencePattern, recordPresenceCorrection } from "@/domain/learning/presencePatterns";

/**
 * "Deze week eet er iemand anders mee dan normaal."
 *
 * Slaat een uitzondering op voor één concrete datum en laat het patroon
 * ongemoeid — dat is de hele reden dat `PersonPresenceDateOverride` een eigen
 * tabel is. Eén afwijkende vrijdag betekent niet dat vrijdag voortaan anders
 * is; pas als zoiets zich herhaalt mag de app ernaar vrágen.
 *
 * Werkt op een datum uit het formulier, niet op een id: het huishouden komt
 * uit de sessie en de personen worden daarbinnen opgezocht.
 */
export async function setDatePresence(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const parsedDate = parseOrderDate(String(formData.get("date") ?? ""));
  if (!parsedDate) throw new Error("Onbekende datum.");
  // Een `@db.Date`-kolom bewaart het UTC-datumdeel; lokale middernacht zou in
  // Nederlandse tijd een dag te vroeg terechtkomen (zie toCalendarDate).
  const date = toCalendarDate(parsedDate);
  const presentIds = new Set(formData.getAll("presentPersonId").map(String));

  const persons = await prisma.person.findMany({
    where: { householdId },
    select: { id: true, name: true, defaultPresent: true, presenceOverrides: true },
  });

  for (const person of persons) {
    const present = presentIds.has(person.id);
    await prisma.personPresenceDateOverride.upsert({
      where: { personId_date: { personId: person.id, date } },
      create: { personId: person.id, date, present },
      update: { present },
    });

    // Alleen een échte afwijking van het verwachte ritme is iets om van te
    // leren; wie gewoon meedoet zoals altijd levert geen patroon op.
    // De verwachting volgens het weekritme, zonder de datum-uitzonderingen
    // zelf: die zijn juist wat we hier aan het opschrijven zijn.
    const expected = isPersonPresentOnDate(
      { ...person, portionMultiplier: 1, presenceDateOverrides: [] },
      parsedDate
    );
    if (present !== expected) {
      await recordPresenceCorrection({
        householdId,
        personId: person.id,
        personName: person.name,
        dayOfWeek: DAY_ENUM[dayKeyForDate(parsedDate)],
        present,
      });
    }
  }

  // Andere eters betekent andere hoeveelheden op de lijst van deze week.
  const mealPlan = await prisma.mealPlan.findUnique({
    where: { householdId_weekStart: { householdId, weekStart: getCurrentWeekStart() } },
    select: { id: true },
  });
  if (mealPlan) await invalidateShoppingList(mealPlan.id, { keepListRow: true });

  revalidatePath("/week");
  revalidatePath("/boodschappen");
  redirect(`/week?status=date-presence-saved&dag=${encodeURIComponent(String(formData.get("date")))}#day-${String(formData.get("dayKey") ?? "")}`);
}

/** Zet de uitzondering voor één datum weer terug naar het gewone ritme. */
export async function clearDatePresence(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const parsedDate = parseOrderDate(String(formData.get("date") ?? ""));
  if (!parsedDate) throw new Error("Onbekende datum.");
  const date = toCalendarDate(parsedDate);

  await prisma.personPresenceDateOverride.deleteMany({
    where: { date, person: { householdId } },
  });

  const mealPlan = await prisma.mealPlan.findUnique({
    where: { householdId_weekStart: { householdId, weekStart: getCurrentWeekStart() } },
    select: { id: true },
  });
  if (mealPlan) await invalidateShoppingList(mealPlan.id, { keepListRow: true });

  revalidatePath("/week");
  revalidatePath("/boodschappen");
  redirect(`/week?status=date-presence-cleared&dag=${encodeURIComponent(String(formData.get("date")))}#day-${String(formData.get("dayKey") ?? "")}`);
}

/**
 * "Ja, zet dat zo in ons weekritme" — het geleerde patroon wordt pas hier het
 * nieuwe verwachte ritme. Tot dat moment is het niets meer dan een observatie.
 */
export async function confirmPresencePatternPrompt(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const promptId = String(formData.get("promptId"));

  await applyPresencePattern(householdId, promptId);

  const mealPlan = await prisma.mealPlan.findUnique({
    where: { householdId_weekStart: { householdId, weekStart: getCurrentWeekStart() } },
    select: { id: true },
  });
  if (mealPlan) await invalidateShoppingList(mealPlan.id, { keepListRow: true });

  revalidatePath("/week");
  revalidatePath("/boodschappen");
  revalidatePath("/ons-gezin");
  redirect(`/week?status=presence-pattern-applied&vraag=${encodeURIComponent(promptId)}#leervragen`);
}
