"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold } from "@/lib/auth";
import { getCurrentWeekStart } from "@/lib/week";
import { invalidateShoppingList } from "@/lib/shoppingList";

/**
 * "Losse boodschappenlijst starten": voor als je even geen weekmenu wilt,
 * gewoon standaard boodschappen. Zet alle dagen van deze week op "uit eten"
 * (dezelfde `skipped`-vlag als de losse "Uit eten"-knop per dag, zie
 * `toggleMealPlanEntrySkipped` in `src/app/actions.ts`) en wist de huidige
 * boodschappenlijst, zodat de eerstvolgende `ensureShoppingList`-aanroep een
 * verse lijst opbouwt zonder weekmenu-regels. Vaste boodschappen komen
 * automatisch terug (`FixedGrocery` is een los, huishouden-breed model, hier
 * niet aangeraakt) — de rest voegt de gebruiker zelf toe (bv. via "snel
 * meerdere producten toevoegen").
 *
 * Raakt nooit het echte Picnic-mandje — alleen de lijst in deze app.
 */
export async function startLooseShoppingList(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);

  const weekStart = getCurrentWeekStart();
  const mealPlan = await prisma.mealPlan.findUniqueOrThrow({
    where: { householdId_weekStart: { householdId, weekStart } },
  });

  await prisma.mealPlanEntry.updateMany({
    where: { mealPlanId: mealPlan.id },
    data: { skipped: true },
  });
  await invalidateShoppingList(mealPlan.id);

  revalidatePath("/boodschappen");
  revalidatePath("/controle");
  revalidatePath("/");
  redirect("/boodschappen?status=loose-list-started#loose-list");
}
