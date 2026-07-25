"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { logFeedbackEvent } from "@/lib/feedback";
import { recalculateVariantConfidence, maybePromoteRecipeStatus } from "@/lib/scoring";
import { DAY_ENUM, type DayKey } from "@/lib/week";

/**
 * De "eenmalige, korte" feedbackvraag bij nieuwe gerechten (sectie 7 van
 * de Blueprint). Zodra dit één keer expliciet beantwoord is, promoveert
 * het gerecht voorbij status FOUND, dus de vraag verschijnt vanzelf niet
 * opnieuw.
 */
export async function submitMealFeedback(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  const recipeVariantId = String(formData.get("recipeVariantId"));
  const dayKey = String(formData.get("dayKey")) as DayKey;
  const positive = formData.get("positive") === "true";

  const household = await prisma.household.findUniqueOrThrow({ where: { id: householdId } });
  const rhythm = (household.weeklyRhythm ?? {}) as unknown as Partial<Record<DayKey, string>>;
  const busy = rhythm[dayKey] === "busy";

  await logFeedbackEvent({
    householdId,
    subjectType: "RECIPE_VARIANT",
    subjectId: recipeVariantId,
    eventType: "EXPLICIT_FEEDBACK",
    explicit: true,
    context: { dayOfWeek: DAY_ENUM[dayKey], busy, positive },
  });

  await recalculateVariantConfidence(householdId, recipeVariantId);
  await maybePromoteRecipeStatus(recipeVariantId, householdId);

  revalidatePath("/");
}
