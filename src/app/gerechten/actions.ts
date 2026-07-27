"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold } from "@/lib/auth";
import { logFeedbackEvent } from "@/lib/feedback";
import { invalidateShoppingList } from "@/lib/shoppingList";
import { recalculateVariantConfidence, maybePromoteRecipeStatus } from "@/lib/scoring";
import { getHouseholdHardRestrictions, getHouseholdMealParticipantsByDay } from "@/lib/household";
import { recipeConflictsWithRestrictions } from "@/lib/dietaryRestrictions";
import { accessibleRecipeWhere } from "@/lib/recipeScope";
import { DAY_ENUM, DAY_KEYS, type DayKey } from "@/lib/week";
import { parseFeedbackReason, labelFeedbackReason } from "@/domain/learning/feedbackReasons";
import { recordRepeatedMealReplacement } from "@/domain/learning/patterns";

export async function replaceMealPlanEntry(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const dayKey = String(formData.get("dayKey")) as DayKey;
  if (!DAY_KEYS.includes(dayKey)) {
    throw new Error("Onbekende dag.");
  }
  const recipeVariantId = String(formData.get("recipeVariantId"));
  const weekStart = new Date(String(formData.get("weekStart")));
  const replacementReason = parseFeedbackReason(formData.get("replacementReason")) ?? "ONLY_THIS_TIME";

  // Server actions zijn een publiek bereikbaar POST-endpoint (elke
  // aanroeper kan hetzelfde form-veld met een andere id versturen) — de UI
  // filtert onveilige gerechten al weg, maar dat is geen beveiliging.
  // Daarom hier nogmaals hard controleren, ongeacht wat er binnenkomt.
  const [variant, hardRestrictions, participantsByDay] = await Promise.all([
    prisma.recipeVariant.findUniqueOrThrow({
      where: { id: recipeVariantId, recipe: accessibleRecipeWhere(householdId) },
      include: { recipe: { include: { ingredients: { include: { ingredient: true } } } } },
    }),
    getHouseholdHardRestrictions(householdId, dayKey),
    getHouseholdMealParticipantsByDay(householdId),
  ]);
  const neverPreference = await prisma.preference.findFirst({
    where: {
      ownerType: "PERSON",
      ownerId: { in: participantsByDay[dayKey].map((person) => person.id) },
      OR: [
        { subjectType: "RECIPE_VARIANT", subjectId: recipeVariantId },
        { subjectType: "RECIPE_CATEGORY", subjectId: variant.recipe.category },
        {
          subjectType: "INGREDIENT",
          subjectId: { in: variant.recipe.ingredients.map((ri) => ri.ingredientId) },
        },
      ],
      stance: "NEVER",
    },
  });
  if (neverPreference) {
    throw new Error("Dit gerecht botst met een persoonlijke 'nooit'-voorkeur van iemand die deze dag mee-eet.");
  }
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
    const replacedVariant = await prisma.recipeVariant.findUniqueOrThrow({
      where: { id: currentEntry.recipeVariantId },
      include: { recipe: { select: { category: true, title: true } } },
    });
    await logFeedbackEvent({
      householdId,
      subjectType: "RECIPE_VARIANT",
      subjectId: currentEntry.recipeVariantId,
      eventType: "REPLACED",
      reason: replacementReason,
      explicit: true,
      context: { dayOfWeek: dayEnum, reasonLabel: labelFeedbackReason(replacementReason) },
    });
    await recordRepeatedMealReplacement({
      householdId,
      dayOfWeek: dayEnum,
      replacedRecipeVariantId: currentEntry.recipeVariantId,
      replacementRecipeVariantId: recipeVariantId,
      replacedRecipeCategory: replacedVariant.recipe.category,
      replacedRecipeTitle: replacedVariant.recipe.title,
      reason: replacementReason,
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
    context: { dayOfWeek: dayEnum, source: "manual_replace", replacementReason },
  });
  await recalculateVariantConfidence(householdId, recipeVariantId);
  await maybePromoteRecipeStatus(recipeVariantId, householdId);

  // De boodschappenlijst hoort mee te veranderen zodra een gerecht wijzigt.
  await invalidateShoppingList(mealPlan.id);

  revalidatePath("/");
  revalidatePath("/boodschappen");
  redirect("/");
}
