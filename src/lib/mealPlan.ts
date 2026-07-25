import { prisma } from "./prisma";
import { logFeedbackEvent } from "./feedback";
import { recalculateVariantConfidence, maybePromoteRecipeStatus } from "./scoring";
import { DAY_KEYS, DAY_ENUM, dateForDay, type DayKey } from "./week";
import type { ConfidenceLevel } from "@/generated/prisma/enums";

type WeeklyRhythm = Partial<Record<DayKey, "busy" | "quiet">>;

const BUSY_VARIANT_TYPES = new Set(["FAST", "REHEATABLE"]);

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

  const [household, preferences, variants] = await Promise.all([
    prisma.household.findUniqueOrThrow({ where: { id: householdId } }),
    prisma.preference.findMany({
      where: {
        ownerType: "HOUSEHOLD",
        ownerId: householdId,
        subjectType: "RECIPE_CATEGORY",
        stance: "LIKED",
      },
    }),
    prisma.recipeVariant.findMany({ include: { recipe: true } }),
  ]);

  const preferredCategories = new Set(preferences.map((p) => p.subjectId));
  const rhythm = (household.weeklyRhythm ?? {}) as unknown as WeeklyRhythm;

  const usedRecipeIds = new Set<string>();
  type VariantWithRecipe = (typeof variants)[number];
  type Pick = { variant: VariantWithRecipe; reason: string; confidence: ConfidenceLevel };
  const picks = {} as Record<DayKey, Pick>;

  for (const dayKey of DAY_KEYS) {
    const busy = rhythm[dayKey] === "busy";
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

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    usedRecipeIds.add(chosen.recipeId);

    const reasonParts: string[] = [];
    if (busy && (BUSY_VARIANT_TYPES.has(chosen.variantType) || chosen.contextFit.includes("drukke_dag"))) {
      reasonParts.push("past goed bij een drukke dag");
    }
    if (preferredCategories.has(chosen.recipe.category)) {
      reasonParts.push("sluit aan bij jullie voorkeuren");
    }
    if (reasonParts.length === 0) {
      reasonParts.push("nieuwe suggestie om te proberen");
    }

    picks[dayKey] = {
      variant: chosen,
      reason: `${chosen.recipe.title} ${reasonParts.join(" en ")}.`,
      confidence,
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
