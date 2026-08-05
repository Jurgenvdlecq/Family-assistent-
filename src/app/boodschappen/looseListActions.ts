"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold } from "@/lib/auth";
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
 *
 * `weekStart` komt uit een hidden formuliervveld (net als
 * `toggleMealPlanEntrySkipped`), niet uit een eigen `getCurrentWeekStart()`-
 * aanroep hier: anders zou een aanvraag die net ná middernacht
 * zondag/maandag binnenkomt een `weekStart` van de nieuwe week berekenen,
 * terwijl de pagina die de gebruiker zag (en de bevestiging die hij las) nog
 * de vorige week toonde — dan bestaat er nog geen MealPlan-rij voor die
 * "nieuwe" week en zou een kale throw de generieke Next.js-foutpagina tonen
 * (hetzelfde patroon als de eerder gefixte Picnic-bugs). Bij een ontbrekende
 * meal plan daarom een nette statusmelding i.p.v. een throw.
 */
export async function startLooseShoppingList(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);

  const weekStart = new Date(String(formData.get("weekStart")));
  const mealPlan = await prisma.mealPlan.findUnique({
    where: { householdId_weekStart: { householdId, weekStart } },
  });
  if (!mealPlan) {
    redirect("/boodschappen?status=loose-list-week-changed#loose-list");
  }

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
