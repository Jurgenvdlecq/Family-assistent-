"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireCurrentHousehold } from "@/lib/auth";
import { ensureMealPlan } from "@/lib/mealPlan";
import { invalidateShoppingList } from "@/lib/shoppingList";
import { dayKeyForDate, isSelectableOrderDate, parseOrderDate } from "@/lib/orderDays";
import { DAY_ENUM, getCurrentWeekStart } from "@/lib/week";

function backToPicker(status: string): never {
  redirect(`/boodschappen?status=${encodeURIComponent(status)}#avondeten`);
}

/**
 * Zet één avond aan of uit voor de eerstvolgende bestelling.
 *
 * Werkt bewust op een **datum** uit het formulier en niet op een
 * `mealPlanEntryId`: er komt dus geen door de client aangeleverde id in een
 * databaselookup terecht. De weekplanning wordt opgezocht via het huishouden
 * uit de sessie (`requireCurrentHousehold` + `ensureMealPlan`), waarna de rij
 * wordt bijgewerkt op (dat weekplan, die dag). Een gemanipuleerd formulier
 * kan daarmee hooguit een eigen avond aan- of uitzetten.
 *
 * De datum mag over de weekgrens heen liggen (bezorging op zaterdag, koken op
 * dinsdag). Valt hij in de volgende week en bestaat dat weekplan nog niet,
 * dan maakt `ensureMealPlan` het alsnog aan — precies de "volgende week
 * plannen"-behoefte, hier vanzelf ingevuld.
 *
 * Raakt nooit `skipped`: "we gaan uit eten" en "hier koop ik nu geen
 * boodschappen voor" blijven twee verschillende dingen.
 */
export async function setMealIncludedInGroceries(formData: FormData) {
  const household = await requireCurrentHousehold();
  const date = parseOrderDate(String(formData.get("date") ?? ""));
  const included = String(formData.get("included") ?? "") === "true";

  if (!date || !isSelectableOrderDate(date, new Date(), included ? "add" : "remove")) {
    // Bijvoorbeeld een tabblad dat sinds gisteren openstond: de dag die daar
    // nog getoond werd, ligt inmiddels in het verleden.
    backToPicker("order-day-out-of-range");
  }

  const currentWeekStart = getCurrentWeekStart();
  const weekStartForDate = getCurrentWeekStart(date);
  const mealPlan = await ensureMealPlan(household.id, weekStartForDate);
  if (!mealPlan) {
    backToPicker("order-day-plan-missing");
  }

  const updated = await prisma.mealPlanEntry.updateMany({
    where: { mealPlanId: mealPlan.id, dayOfWeek: DAY_ENUM[dayKeyForDate(date)] },
    data: { includedInGroceries: included },
  });
  if (updated.count === 0) {
    backToPicker("order-day-plan-missing");
  }

  // De bestelling zelf hangt altijd aan het weekplan van déze week, ook als
  // de gewijzigde avond in de volgende week valt — daar wordt de lijst
  // opnieuw opgebouwd (zie getGroceryMealEntries). Ging het net al om deze
  // week, dan hebben we dat plan hierboven al: geen tweede opzoekactie.
  const currentWeekPlan =
    weekStartForDate.getTime() === currentWeekStart.getTime()
      ? mealPlan
      : await ensureMealPlan(household.id, currentWeekStart);
  if (currentWeekPlan) {
    await invalidateShoppingList(currentWeekPlan.id);
  }

  revalidatePath("/boodschappen");
  revalidatePath("/controle");
  revalidatePath("/week");
  backToPicker(included ? "meal-day-added" : "meal-day-removed");
}
