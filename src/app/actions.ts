"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold } from "@/lib/auth";
import { logFeedbackEvent } from "@/lib/feedback";
import { recalculateVariantConfidence, maybePromoteRecipeStatus } from "@/lib/scoring";
import { DAY_ENUM, DAY_KEYS, type DayKey } from "@/lib/week";

const PERSONAL_STANCES = ["LIKED", "SOMETIMES", "RATHER_NOT", "NEVER"] as const;
const PERSONAL_SUBJECT_TYPES = ["RECIPE_VARIANT", "RECIPE_CATEGORY", "INGREDIENT"] as const;
const RECIPE_CATEGORIES = [
  "PASTA",
  "WRAPS",
  "RICE_DISH",
  "ALL_VEGGIE_DAY",
  "QUICK_AND_EASY",
  "COMFORT_FOOD",
  "AIRFRYER",
  "OTHER",
] as const;

function parsePersonalStance(value: FormDataEntryValue | null): (typeof PERSONAL_STANCES)[number] {
  const stance = String(value ?? "SOMETIMES");
  if (!PERSONAL_STANCES.includes(stance as (typeof PERSONAL_STANCES)[number])) {
    throw new Error("Onbekende voorkeur.");
  }
  return stance as (typeof PERSONAL_STANCES)[number];
}

function parsePersonalSubjectType(value: FormDataEntryValue | null): (typeof PERSONAL_SUBJECT_TYPES)[number] {
  const subjectType = String(value ?? "RECIPE_VARIANT");
  if (!PERSONAL_SUBJECT_TYPES.includes(subjectType as (typeof PERSONAL_SUBJECT_TYPES)[number])) {
    throw new Error("Onbekend voorkeurstype.");
  }
  return subjectType as (typeof PERSONAL_SUBJECT_TYPES)[number];
}

/**
 * De "eenmalige, korte" feedbackvraag bij nieuwe gerechten (sectie 7 van
 * de Blueprint). Zodra dit één keer expliciet beantwoord is, promoveert
 * het gerecht voorbij status FOUND, dus de vraag verschijnt vanzelf niet
 * opnieuw.
 */
export async function submitMealFeedback(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
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

export async function setPersonMealPreference(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const personId = String(formData.get("personId"));
  const subjectType = parsePersonalSubjectType(formData.get("subjectType"));
  const subjectId = String(formData.get("subjectId") ?? formData.get("recipeVariantId"));
  const dayKey = String(formData.get("dayKey")) as DayKey;
  const stance = parsePersonalStance(formData.get("stance"));

  if (!DAY_KEYS.includes(dayKey)) {
    throw new Error("Onbekende dag.");
  }

  await prisma.person.findUniqueOrThrow({
    where: { id: personId, householdId },
    select: { id: true },
  });
  if (subjectType === "RECIPE_VARIANT") {
    await prisma.recipeVariant.findUniqueOrThrow({ where: { id: subjectId }, select: { id: true } });
  } else if (subjectType === "INGREDIENT") {
    await prisma.ingredient.findUniqueOrThrow({ where: { id: subjectId }, select: { id: true } });
  } else if (!RECIPE_CATEGORIES.includes(subjectId as (typeof RECIPE_CATEGORIES)[number])) {
    throw new Error("Onbekende categorie.");
  }

  await prisma.preference.upsert({
    where: {
      ownerType_ownerId_subjectType_subjectId: {
        ownerType: "PERSON",
        ownerId: personId,
        subjectType,
        subjectId,
      },
    },
    update: { stance, source: "EXPLICIT", confidence: 1 },
    create: {
      ownerType: "PERSON",
      ownerId: personId,
      subjectType,
      subjectId,
      stance,
      source: "EXPLICIT",
      confidence: 1,
    },
  });

  await logFeedbackEvent({
    householdId,
    personId,
    subjectType,
    subjectId,
    eventType: "EXPLICIT_FEEDBACK",
    explicit: true,
    context: { dayOfWeek: DAY_ENUM[dayKey], stance, source: "personal_week_plan" },
  });

  revalidatePath("/");
  revalidatePath("/gerechten");
}
