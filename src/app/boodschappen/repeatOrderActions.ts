"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireCurrentHousehold } from "@/lib/auth";
import { ensureMealPlan } from "@/lib/mealPlan";
import { ensureShoppingList, invalidateShoppingList } from "@/lib/shoppingList";
import { isSelectableOrderDate } from "@/lib/orderDays";
import { DAY_ENUM, DAY_KEY_BY_ENUM, dateForDay, getCurrentWeekStart } from "@/lib/week";
import { previousWeekStart } from "@/lib/repeatOrder";

/**
 * "Herhaal je vorige bestelling."
 *
 * Neemt twee dingen over: de producten die je vorige keer zelf hebt
 * toegevoegd, en de avonden waarop je toen kookte. Bewust níet de
 * gerechten van toen — voor die avonden komen verse voorstellen, want
 * hetzelfde eten in twee opeenvolgende weken is meestal niet de bedoeling.
 * Vaste boodschappen staan sowieso al op de lijst; die zitten hier dus niet in.
 *
 * Avonden die inmiddels voorbij zijn worden overgeslagen: boodschappen voor
 * een dag die al geweest is slaan nergens op. Werkt zonder enige id uit het
 * formulier — alles wordt afgeleid uit het huishouden in de sessie.
 */
export async function repeatPreviousOrder() {
  const household = await requireCurrentHousehold();
  const now = new Date();

  const previousPlan = await prisma.mealPlan.findUnique({
    where: { householdId_weekStart: { householdId: household.id, weekStart: previousWeekStart() } },
    include: {
      entries: { select: { dayOfWeek: true, includedInGroceries: true } },
      shoppingList: {
        include: { lines: { include: { ingredient: true } } },
      },
    },
  });

  if (!previousPlan?.shoppingList) {
    redirect("/boodschappen?status=repeat-none#quick-order");
  }

  const currentPlan = await ensureMealPlan(household.id, getCurrentWeekStart());
  if (!currentPlan) {
    redirect("/boodschappen?status=repeat-none#quick-order");
  }

  // 1) Dezelfde kookavonden aanvinken — alleen de dagen die nog komen.
  const repeatedDayKeys = previousPlan.entries
    .filter((entry) => entry.includedInGroceries)
    .map((entry) => DAY_KEY_BY_ENUM[entry.dayOfWeek])
    .filter((dayKey) => isSelectableOrderDate(dateForDay(getCurrentWeekStart(), dayKey), now, "add"));

  if (repeatedDayKeys.length > 0) {
    await prisma.mealPlanEntry.updateMany({
      where: {
        mealPlanId: currentPlan.id,
        dayOfWeek: { in: repeatedDayKeys.map((dayKey) => DAY_ENUM[dayKey]) },
      },
      data: { includedInGroceries: true },
    });
    // De receptbehoefte van die avonden moet nu in de lijst terechtkomen.
    await invalidateShoppingList(currentPlan.id);
  }

  // 2) De losse toevoegingen van vorige keer overnemen.
  const shoppingList = await ensureShoppingList(currentPlan.id, household.id);
  const alreadyOnList = new Set(
    shoppingList.lines.filter((line) => line.source === "MANUAL").map((line) => `${line.ingredientId}:${line.unit}`)
  );
  const extrasToCopy = previousPlan.shoppingList.lines.filter(
    (line) => line.source === "MANUAL" && !alreadyOnList.has(`${line.ingredientId}:${line.unit}`)
  );

  if (extrasToCopy.length > 0) {
    await prisma.shoppingListLine.createMany({
      data: extrasToCopy.map((line) => ({
        shoppingListId: shoppingList.id,
        ingredientId: line.ingredientId,
        productId: line.productId,
        quantity: line.quantity,
        unit: line.unit,
        source: "MANUAL" as const,
        matchStatus: line.matchStatus,
        matchConfidence: line.matchConfidence,
        matchReasons: line.matchReasons,
      })),
    });
  }

  revalidatePath("/boodschappen");
  revalidatePath("/controle");
  revalidatePath("/week");
  redirect(
    `/boodschappen?status=repeat-done&herhaaldExtras=${extrasToCopy.length}` +
      `&herhaaldeAvonden=${repeatedDayKeys.length}#jullie-boodschappenlijst`
  );
}
