"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold } from "@/lib/auth";
import { logFeedbackEvent } from "@/lib/feedback";
import { invalidateShoppingList } from "@/lib/shoppingList";
import { recalculateVariantConfidence, maybePromoteRecipeStatus } from "@/lib/scoring";
import { getHouseholdHardRestrictions } from "@/lib/household";
import { recipeConflictsWithRestrictions } from "@/lib/dietaryRestrictions";
import { DAY_ENUM, type DayKey } from "@/lib/week";

export async function replaceMealPlanEntry(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const dayKey = String(formData.get("dayKey")) as DayKey;
  const recipeVariantId = String(formData.get("recipeVariantId"));
  const weekStart = new Date(String(formData.get("weekStart")));

  // Server actions zijn een publiek bereikbaar POST-endpoint (elke
  // aanroeper kan hetzelfde form-veld met een andere id versturen) — de UI
  // filtert onveilige gerechten al weg, maar dat is geen beveiliging.
  // Daarom hier nogmaals hard controleren, ongeacht wat er binnenkomt.
  const [variant, hardRestrictions] = await Promise.all([
    prisma.recipeVariant.findUniqueOrThrow({
      where: { id: recipeVariantId },
      include: { recipe: { include: { ingredients: { include: { ingredient: true } } } } },
    }),
    getHouseholdHardRestrictions(householdId),
  ]);
  const conflicts = recipeConflictsWithRestrictions(
    variant.recipe.ingredients.map((ri) => ({
      category: ri.ingredient.category,
      restrictionTags: ri.ingredient.restrictionTags,
    })),
    hardRestrictions
  );
  if (conflicts) {
    throw new Error(
      "Dit gerecht botst met een harde beperking van jullie huishouden en kan niet worden ingepland."
    );
  }

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
