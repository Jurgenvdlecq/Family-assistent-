"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { logFeedbackEvent } from "@/lib/feedback";
import { invalidateShoppingList } from "@/lib/shoppingList";
import { recalculateVariantConfidence, maybePromoteRecipeStatus } from "@/lib/scoring";
import { DAY_ENUM, type DayKey } from "@/lib/week";

export async function replaceMealPlanEntry(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  const dayKey = String(formData.get("dayKey")) as DayKey;
  const recipeVariantId = String(formData.get("recipeVariantId"));
  const weekStart = new Date(String(formData.get("weekStart")));

  const mealPlan = await prisma.mealPlan.findUniqueOrThrow({
    where: { householdId_weekStart: { householdId, weekStart } },
    include: { entries: true },
  });

  const dayEnum = DAY_ENUM[dayKey];
  const currentEntry = mealPlan.entries.find((e) => e.dayOfWeek === dayEnum);

  if (currentEntry) {
    if (currentEntry.recipeVariantId === recipeVariantId) {
      redirect("/");
    }
    await logFeedbackEvent({
      householdId,
      subjectType: "RECIPE_VARIANT",
      subjectId: currentEntry.recipeVariantId,
      eventType: "REPLACED",
      explicit: true,
      context: { dayOfWeek: dayEnum },
    });
    await recalculateVariantConfidence(householdId, currentEntry.recipeVariantId);
    await prisma.mealPlanEntry.update({
      where: { id: currentEntry.id },
      data: { recipeVariantId },
    });
  } else {
    await prisma.mealPlanEntry.create({
      data: { mealPlanId: mealPlan.id, dayOfWeek: dayEnum, recipeVariantId },
    });
  }

  await logFeedbackEvent({
    householdId,
    subjectType: "RECIPE_VARIANT",
    subjectId: recipeVariantId,
    eventType: "CHOSEN",
    explicit: true,
    context: { dayOfWeek: dayEnum, source: "manual_replace" },
  });
  await recalculateVariantConfidence(householdId, recipeVariantId);
  await maybePromoteRecipeStatus(recipeVariantId, householdId);

  // De boodschappenlijst hoort mee te veranderen zodra een gerecht wijzigt.
  await invalidateShoppingList(mealPlan.id);

  revalidatePath("/");
  revalidatePath("/boodschappen");
  redirect("/");
}
