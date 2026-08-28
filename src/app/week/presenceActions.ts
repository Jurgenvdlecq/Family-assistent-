"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold } from "@/lib/auth";
import { invalidateShoppingList } from "@/lib/shoppingList";
import { getCurrentWeekStart } from "@/lib/week";
import { parseOrderDate } from "@/lib/orderDays";

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
  const date = parseOrderDate(String(formData.get("date") ?? ""));
  if (!date) throw new Error("Onbekende datum.");
  const presentIds = new Set(formData.getAll("presentPersonId").map(String));

  const persons = await prisma.person.findMany({
    where: { householdId },
    select: { id: true },
  });

  for (const person of persons) {
    const present = presentIds.has(person.id);
    await prisma.personPresenceDateOverride.upsert({
      where: { personId_date: { personId: person.id, date } },
      create: { personId: person.id, date, present },
      update: { present },
    });
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
  const date = parseOrderDate(String(formData.get("date") ?? ""));
  if (!date) throw new Error("Onbekende datum.");

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
