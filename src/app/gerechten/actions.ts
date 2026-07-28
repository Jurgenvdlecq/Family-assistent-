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
import type { IngredientCategory, Unit } from "@/generated/prisma/enums";

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
      data: {
        recipeVariantId,
        source: "MANUAL",
        status: "ACCEPTED",
        reason: "Je hebt dit zelf gekozen.",
        score: null,
        confidenceLevel: "CERTAIN",
        replacedFromRecipeVariantId: currentEntry.recipeVariantId,
      },
    });
  } else {
    await prisma.mealPlanEntry.create({
      data: {
        mealPlanId: mealPlan.id,
        dayOfWeek: dayEnum,
        recipeVariantId,
        source: "MANUAL",
        status: "ACCEPTED",
        reason: "Je hebt dit zelf gekozen.",
        confidenceLevel: "CERTAIN",
      },
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

function defaultQuantityForIngredient(category: IngredientCategory, unit: Unit) {
  if (unit === "PIECE") {
    if (category === "VEGETABLE" || category === "FRUIT") return 2;
    return 1;
  }
  if (unit === "ML") return 250;
  if (category === "MEAT" || category === "FISH") return 400;
  if (category === "GRAIN" || category === "LEGUME") return 300;
  if (category === "VEGETABLE") return 600;
  return 250;
}

function categoryForLiteralMeal(ingredients: { category: IngredientCategory; name: string }[]) {
  const normalizedNames = ingredients.map((ingredient) => ingredient.name.toLowerCase()).join(" ");
  if (normalizedNames.includes("pasta") || normalizedNames.includes("spaghetti") || normalizedNames.includes("macaroni")) return "PASTA" as const;
  if (normalizedNames.includes("wrap") || normalizedNames.includes("tortilla")) return "WRAPS" as const;
  if (normalizedNames.includes("rijst")) return "RICE_DISH" as const;
  const hasProtein = ingredients.some((ingredient) => ["MEAT", "FISH", "LEGUME"].includes(ingredient.category));
  const hasVegetable = ingredients.some((ingredient) => ingredient.category === "VEGETABLE");
  const hasStarch = normalizedNames.includes("aardappel") || normalizedNames.includes("rijst") || normalizedNames.includes("pasta");
  if (hasProtein && hasVegetable && hasStarch) return "ALL_VEGGIE_DAY" as const;
  return "QUICK_AND_EASY" as const;
}

function literalMealTitle(ingredientNames: string[]) {
  const names = ingredientNames.map((name) => name.toLowerCase());
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} met ${names[1]}`;
  return `${names[0]} met ${names.slice(1).join(" en ")}`;
}

export async function chooseLiteralMealPlanEntry(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const dayKey = String(formData.get("dayKey")) as DayKey;
  if (!DAY_KEYS.includes(dayKey)) {
    throw new Error("Onbekende dag.");
  }
  const weekStart = new Date(String(formData.get("weekStart")));
  const ingredientIds = String(formData.get("ingredientIds") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (ingredientIds.length < 3) {
    throw new Error("Noem minimaal drie concrete ingrediënten, bijvoorbeeld kip, rijst en paprika.");
  }

  const ingredients = await prisma.ingredient.findMany({
    where: { id: { in: ingredientIds } },
    select: { id: true, name: true, unit: true, category: true, restrictionTags: true },
  });
  if (ingredients.length !== new Set(ingredientIds).size) {
    throw new Error("Ik herkende niet alle ingrediënten.");
  }

  const [hardRestrictions, participantsByDay] = await Promise.all([
    getHouseholdHardRestrictions(householdId, dayKey),
    getHouseholdMealParticipantsByDay(householdId),
  ]);
  const conflicts = recipeConflictsWithRestrictions(
    ingredients.map((ingredient) => ({
      category: ingredient.category,
      restrictionTags: ingredient.restrictionTags,
    })),
    hardRestrictions
  );
  if (conflicts) {
    throw new Error("Deze combinatie botst met een harde beperking van jullie huishouden.");
  }
  const neverPreference = await prisma.preference.findFirst({
    where: {
      ownerType: "PERSON",
      ownerId: { in: participantsByDay[dayKey].map((person) => person.id) },
      subjectType: "INGREDIENT",
      subjectId: { in: ingredients.map((ingredient) => ingredient.id) },
      stance: "NEVER",
    },
  });
  if (neverPreference) {
    throw new Error("Deze combinatie botst met een persoonlijke 'nooit'-voorkeur van iemand die deze dag mee-eet.");
  }

  const orderedIngredients = ingredientIds
    .map((id) => ingredients.find((ingredient) => ingredient.id === id))
    .filter((ingredient): ingredient is (typeof ingredients)[number] => Boolean(ingredient));
  const title = literalMealTitle(orderedIngredients.map((ingredient) => ingredient.name));
  const category = categoryForLiteralMeal(orderedIngredients);

  const recipe = await prisma.recipe.create({
    data: {
      title,
      category,
      scope: "HOUSEHOLD",
      householdId,
      status: "FOUND",
      properties: ["concrete_wens", "snel_te_plannen"],
      ingredients: {
        create: orderedIngredients.map((ingredient) => ({
          ingredientId: ingredient.id,
          quantity: defaultQuantityForIngredient(ingredient.category, ingredient.unit),
          unit: ingredient.unit,
        })),
      },
      variants: {
        create: {
          variantType: "FRESH",
          contextFit: ["handmatige_wens"],
        },
      },
    },
    include: { variants: true },
  });
  const recipeVariantId = recipe.variants[0]?.id;
  if (!recipeVariantId) throw new Error("Kon geen variant maken voor deze maaltijd.");

  const mealPlan = await prisma.mealPlan.findUniqueOrThrow({
    where: { householdId_weekStart: { householdId, weekStart } },
    include: { entries: true },
  });
  const dayEnum = DAY_ENUM[dayKey];
  const currentEntry = mealPlan.entries.find((entry) => entry.dayOfWeek === dayEnum);
  if (currentEntry) {
    await prisma.mealPlanEntry.update({
      where: { id: currentEntry.id },
      data: {
        recipeVariantId,
        source: "ASSISTANT",
        status: "ACCEPTED",
        reason: "Gemaakt op basis van je wens.",
        score: null,
        confidenceLevel: "CERTAIN",
        replacedFromRecipeVariantId: currentEntry.recipeVariantId,
      },
    });
  } else {
    await prisma.mealPlanEntry.create({
      data: {
        mealPlanId: mealPlan.id,
        dayOfWeek: dayEnum,
        recipeVariantId,
        source: "ASSISTANT",
        status: "ACCEPTED",
        reason: "Gemaakt op basis van je wens.",
        confidenceLevel: "CERTAIN",
      },
    });
  }

  await logFeedbackEvent({
    householdId,
    subjectType: "RECIPE_VARIANT",
    subjectId: recipeVariantId,
    eventType: "CHOSEN",
    explicit: true,
    context: { dayOfWeek: dayEnum, source: "literal_meal_wish", ingredientIds },
  });
  await invalidateShoppingList(mealPlan.id);

  revalidatePath("/");
  revalidatePath("/boodschappen");
  redirect("/");
}
