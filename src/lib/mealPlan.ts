import { prisma } from "./prisma";
import { logFeedbackEvent } from "./feedback";
import { recalculateVariantConfidence, maybePromoteRecipeStatus } from "./scoring";
import { DAY_KEYS, DAY_ENUM, dateForDay, type DayKey } from "./week";
import { getHouseholdHardRestrictions } from "./household";
import { recipeConflictsWithRestrictions } from "./dietaryRestrictions";
import { chooseMealPlanCandidate, formatMealPlanReason } from "@/domain/meal-planning/scoreMealPlanCandidate";
import type { ConfidenceLevel } from "@/generated/prisma/enums";

type WeeklyRhythm = Partial<Record<DayKey, "busy" | "quiet">>;

const BUSY_VARIANT_TYPES = new Set(["FAST", "REHEATABLE"]);
const RECENT_PLANNING_WINDOW_DAYS = 56;

const MEAL_PLAN_INCLUDE = {
  entries: {
    include: {
      recipeVariant: {
        include: {
          recipe: {
            include: {
              ingredients: { include: { ingredient: true } },
            },
          },
        },
      },
    },
  },
} as const;

export async function getMealPlanForWeek(householdId: string, weekStart: Date) {
  return prisma.mealPlan.findUnique({
    where: { householdId_weekStart: { householdId, weekStart } },
    include: MEAL_PLAN_INCLUDE,
  });
}

/**
 * Zorgt dat er een weekplanning bestaat voor dit huishouden + week.
 * Genereert er bewust één zodra de assistent gevraagd wordt, i.p.v. dat
 * de gebruiker een "plan"-knop moet indrukken (sectie 10 van de Blueprint).
 */
export async function ensureMealPlan(householdId: string, weekStart: Date) {
  const existing = await getMealPlanForWeek(householdId, weekStart);
  if (existing) return existing;

  const recentPlanningStart = new Date(weekStart);
  recentPlanningStart.setDate(recentPlanningStart.getDate() - RECENT_PLANNING_WINDOW_DAYS);

  const [household, preferences, variantPreferences, recentSuggestions, allVariants, hardRestrictionsByDayEntries] = await Promise.all([
    prisma.household.findUniqueOrThrow({ where: { id: householdId } }),
    prisma.preference.findMany({
      where: {
        ownerType: "HOUSEHOLD",
        ownerId: householdId,
        subjectType: "RECIPE_CATEGORY",
        stance: "LIKED",
      },
    }),
    prisma.preference.findMany({
      where: {
        ownerType: "HOUSEHOLD",
        ownerId: householdId,
        subjectType: "RECIPE_VARIANT",
      },
    }),
    prisma.mealSuggestion.findMany({
      where: {
        householdId,
        targetSlot: {
          gte: recentPlanningStart,
          lt: weekStart,
        },
      },
      include: { recipeVariant: { select: { recipeId: true } } },
      orderBy: { targetSlot: "desc" },
    }),
    prisma.recipeVariant.findMany({
      include: { recipe: { include: { ingredients: { include: { ingredient: true } } } } },
    }),
    Promise.all(DAY_KEYS.map(async (dayKey) => [dayKey, await getHouseholdHardRestrictions(householdId, dayKey)] as const)),
  ]);

  const hardRestrictionsByDay = new Map<DayKey, string[]>(hardRestrictionsByDayEntries);
  const safeVariantsForDay = (dayKey: DayKey) =>
    allVariants.filter(
      (v) =>
        !recipeConflictsWithRestrictions(
          v.recipe.ingredients.map((ri) => ({
            category: ri.ingredient.category,
            restrictionTags: ri.ingredient.restrictionTags,
          })),
          hardRestrictionsByDay.get(dayKey) ?? []
        )
    );

  const preferredCategories = new Set(preferences.map((p) => p.subjectId));
  const variantPreferenceById = new Map(
    variantPreferences.map((preference) => [
      preference.subjectId,
      { stance: preference.stance, confidence: preference.confidence },
    ])
  );
  const lastPlannedByRecipeId = new Map<string, Date>();
  for (const suggestion of recentSuggestions) {
    if (!lastPlannedByRecipeId.has(suggestion.recipeVariant.recipeId)) {
      lastPlannedByRecipeId.set(suggestion.recipeVariant.recipeId, suggestion.targetSlot);
    }
  }
  const rhythm = (household.weeklyRhythm ?? {}) as unknown as WeeklyRhythm;

  const usedRecipeIds = new Set<string>();
  type VariantWithRecipe = (typeof allVariants)[number];
  type Pick = { variant: VariantWithRecipe; reason: string; confidence: ConfidenceLevel };
  const picks = {} as Record<DayKey, Pick>;

  for (const dayKey of DAY_KEYS) {
    const busy = rhythm[dayKey] === "busy";
    const variants = safeVariantsForDay(dayKey);
    if (variants.length === 0) {
      throw new Error(
        `Geen enkel gerecht in de bibliotheek voldoet aan de harde beperkingen voor ${DAY_ENUM[dayKey]}. Voeg geschikte recepten toe voordat er een weekplanning gemaakt kan worden.`
      );
    }
    const notUsedYet = variants.filter((v) => !usedRecipeIds.has(v.recipeId));
    const pool = notUsedYet.length > 0 ? notUsedYet : variants;

    const matchesBusy = (v: VariantWithRecipe) =>
      busy ? BUSY_VARIANT_TYPES.has(v.variantType) || v.contextFit.includes("drukke_dag") : true;
    const matchesPreference = (v: VariantWithRecipe) =>
      preferredCategories.size === 0 || preferredCategories.has(v.recipe.category);

    let candidates = pool.filter((v) => matchesBusy(v) && matchesPreference(v));
    let confidence: ConfidenceLevel = "CERTAIN";
    if (candidates.length === 0) {
      candidates = pool.filter(matchesBusy);
      confidence = "SLIGHT_DOUBT";
    }
    if (candidates.length === 0) {
      candidates = pool;
      confidence = "SLIGHT_DOUBT";
    }

    const scored = chooseMealPlanCandidate({
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        recipeId: candidate.recipeId,
        recipeTitle: candidate.recipe.title,
        recipeCategory: candidate.recipe.category,
        recipeStatus: candidate.recipe.status,
        recipeProperties: candidate.recipe.properties,
        variantType: candidate.variantType,
        contextFit: candidate.contextFit,
      })),
      dayKey,
      busy,
      preferredCategories,
      variantPreferences: variantPreferenceById,
      lastPlannedByRecipeId,
      usedRecipeIds,
      targetDate: dateForDay(weekStart, dayKey),
    });
    const chosen = candidates.find((candidate) => candidate.id === scored.candidate.id)!;
    usedRecipeIds.add(chosen.recipeId);

    picks[dayKey] = {
      variant: chosen,
      reason: formatMealPlanReason(scored),
      confidence: confidence === "SLIGHT_DOUBT" ? confidence : scored.confidence,
    };
  }

  await prisma.mealPlan.create({
    data: {
      householdId,
      weekStart,
      status: "CONFIRMED",
      entries: {
        create: DAY_KEYS.map((dayKey) => ({
          dayOfWeek: DAY_ENUM[dayKey],
          recipeVariantId: picks[dayKey].variant.id,
        })),
      },
    },
  });

  await prisma.mealSuggestion.createMany({
    data: DAY_KEYS.map((dayKey) => ({
      householdId,
      recipeVariantId: picks[dayKey].variant.id,
      reason: picks[dayKey].reason,
      confidenceLevel: picks[dayKey].confidence,
      targetSlot: dateForDay(weekStart, dayKey),
    })),
  });

  for (const dayKey of DAY_KEYS) {
    await logFeedbackEvent({
      householdId,
      subjectType: "RECIPE_VARIANT",
      subjectId: picks[dayKey].variant.id,
      eventType: "CHOSEN",
      explicit: false,
      context: {
        dayOfWeek: DAY_ENUM[dayKey],
        busy: rhythm[dayKey] === "busy",
        source: "auto_generated",
      },
    });
    await recalculateVariantConfidence(householdId, picks[dayKey].variant.id);
    await maybePromoteRecipeStatus(picks[dayKey].variant.id, householdId);
  }

  return getMealPlanForWeek(householdId, weekStart);
}

export async function getReasonsForPlan(householdId: string, weekStart: Date) {
  const suggestions = await prisma.mealSuggestion.findMany({
    where: {
      householdId,
      targetSlot: {
        gte: weekStart,
        lte: dateForDay(weekStart, "sunday"),
      },
    },
  });
  return new Map(suggestions.map((s) => [s.recipeVariantId, s.reason]));
}
