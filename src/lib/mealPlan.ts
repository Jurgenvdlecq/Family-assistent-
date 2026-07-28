import { prisma } from "./prisma";
import { logFeedbackEvent } from "./feedback";
import { recalculateVariantConfidence, maybePromoteRecipeStatus } from "./scoring";
import { DAY_KEYS, DAY_ENUM, DAY_KEY_BY_ENUM, DAY_LABELS, dateForDay, type DayKey } from "./week";
import { getHouseholdHardRestrictions, getHouseholdMealParticipantsByDay } from "./household";
import { recipeConflictsWithRestrictions } from "./dietaryRestrictions";
import { accessibleRecipeWhere } from "./recipeScope";
import {
  chooseMealPlanCandidate,
  formatMealPlanReason,
  type PersonalRecipeVariantPreference,
  type PersonalSubjectPreference,
} from "@/domain/meal-planning/scoreMealPlanCandidate";
import { entriesForSilentAcceptance } from "@/domain/meal-planning/silentAcceptance";
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
export async function ensureMealPlan(
  householdId: string,
  weekStart: Date,
  entrySource: "AUTO" | "REGENERATED" = "AUTO"
) {
  const existing = await getMealPlanForWeek(householdId, weekStart);
  if (existing) return existing;

  const recentPlanningStart = new Date(weekStart);
  recentPlanningStart.setDate(recentPlanningStart.getDate() - RECENT_PLANNING_WINDOW_DAYS);

  const [
    household,
    preferences,
    variantPreferences,
    recentSuggestions,
    allVariants,
    hardRestrictionsByDayEntries,
    participantsByDay,
    dayRoutines,
  ] = await Promise.all([
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
      where: { recipe: accessibleRecipeWhere(householdId) },
      include: { recipe: { include: { ingredients: { include: { ingredient: true } } } } },
    }),
    Promise.all(DAY_KEYS.map(async (dayKey) => [dayKey, await getHouseholdHardRestrictions(householdId, dayKey)] as const)),
    getHouseholdMealParticipantsByDay(householdId),
    prisma.dayRoutine.findMany({ where: { householdId } }),
  ]);
  const dayRoutineByDay = new Map(
    dayRoutines.map((routine) => [DAY_KEY_BY_ENUM[routine.dayOfWeek], routine.recipeVariantId])
  );
  const allVariantIds = allVariants.map((variant) => variant.id);
  const allRecipeCategories = [...new Set(allVariants.map((variant) => variant.recipe.category))];
  const allIngredients = allVariants.flatMap((variant) =>
    variant.recipe.ingredients.map((ri) => ({ id: ri.ingredientId, name: ri.ingredient.name }))
  );
  const allIngredientIds = [...new Set(allIngredients.map((ingredient) => ingredient.id))];
  const ingredientNameById = new Map(allIngredients.map((ingredient) => [ingredient.id, ingredient.name]));
  const allPersonIds = [...new Set(DAY_KEYS.flatMap((dayKey) => participantsByDay[dayKey].map((person) => person.id)))];
  const personNamesById = new Map(
    DAY_KEYS.flatMap((dayKey) => participantsByDay[dayKey].map((person) => [person.id, person.name] as const))
  );
  const personalPreferences = await prisma.preference.findMany({
    where: {
      ownerType: "PERSON",
      ownerId: { in: allPersonIds },
      OR: [
        { subjectType: "RECIPE_VARIANT", subjectId: { in: allVariantIds } },
        { subjectType: "RECIPE_CATEGORY", subjectId: { in: allRecipeCategories } },
        { subjectType: "INGREDIENT", subjectId: { in: allIngredientIds } },
      ],
    },
  });

  const hardRestrictionsByDay = new Map<DayKey, string[]>(hardRestrictionsByDayEntries);
  const personalPreferenceByPersonSubject = new Map(
    personalPreferences.map((preference) => [`${preference.ownerId}:${preference.subjectType}:${preference.subjectId}`, preference])
  );
  const personalPreferencesForDay = (dayKey: DayKey) => {
    const presentPersons = participantsByDay[dayKey];
    const byVariant = new Map<string, PersonalRecipeVariantPreference[]>();
    const byCategory = new Map<string, PersonalSubjectPreference[]>();
    const byIngredient = new Map<string, PersonalSubjectPreference[]>();
    for (const person of presentPersons) {
      for (const variantId of allVariantIds) {
        const preference = personalPreferenceByPersonSubject.get(`${person.id}:RECIPE_VARIANT:${variantId}`);
        if (!preference) continue;
        const list = byVariant.get(variantId) ?? [];
        list.push({
          personName: personNamesById.get(person.id) ?? person.name,
          stance: preference.stance,
          confidence: preference.confidence,
        });
        byVariant.set(variantId, list);
      }
      for (const category of allRecipeCategories) {
        const preference = personalPreferenceByPersonSubject.get(`${person.id}:RECIPE_CATEGORY:${category}`);
        if (!preference) continue;
        const list = byCategory.get(category) ?? [];
        list.push({
          personName: personNamesById.get(person.id) ?? person.name,
          subjectLabel: category.toLowerCase().replaceAll("_", " "),
          stance: preference.stance,
          confidence: preference.confidence,
        });
        byCategory.set(category, list);
      }
      for (const ingredientId of allIngredientIds) {
        const preference = personalPreferenceByPersonSubject.get(`${person.id}:INGREDIENT:${ingredientId}`);
        if (!preference) continue;
        const list = byIngredient.get(ingredientId) ?? [];
        list.push({
          personName: personNamesById.get(person.id) ?? person.name,
          subjectLabel: ingredientNameById.get(ingredientId) ?? "ingrediënt",
          stance: preference.stance,
          confidence: preference.confidence,
        });
        byIngredient.set(ingredientId, list);
      }
    }
    return { byVariant, byCategory, byIngredient };
  };
  const candidateHasNeverPreference = (
    variant: VariantWithRecipe,
    personal: ReturnType<typeof personalPreferencesForDay>
  ) =>
    (personal.byVariant.get(variant.id) ?? []).some((preference) => preference.stance === "NEVER") ||
    (personal.byCategory.get(variant.recipe.category) ?? []).some((preference) => preference.stance === "NEVER") ||
    variant.recipe.ingredients.some((ri) =>
      (personal.byIngredient.get(ri.ingredientId) ?? []).some((preference) => preference.stance === "NEVER")
    );
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
  type Pick = { variant: VariantWithRecipe; reason: string; confidence: ConfidenceLevel; score?: number };
  const picks = {} as Record<DayKey, Pick>;

  for (const dayKey of DAY_KEYS) {
    const busy = rhythm[dayKey] === "busy";
    const personalPreferencesForPresentPersons = personalPreferencesForDay(dayKey);
    const variants = safeVariantsForDay(dayKey).filter(
      (variant) => !candidateHasNeverPreference(variant, personalPreferencesForPresentPersons)
    );
    if (variants.length === 0) {
      throw new Error(
        `Geen enkel gerecht in de bibliotheek voldoet aan de harde beperkingen voor ${DAY_ENUM[dayKey]}. Voeg geschikte recepten toe voordat er een weekplanning gemaakt kan worden.`
      );
    }

    // Een expliciet onthouden daggewoonte (WP51) wint van de gewone scoring,
    // maar alleen zolang hij nog steeds veilig is (variants is al gefilterd
    // op harde beperkingen en NEVER-voorkeuren) — "hard is hard" blijft
    // gelden, ook voor een vaste gewoonte.
    const routineVariantId = dayRoutineByDay.get(dayKey);
    const routineVariant = routineVariantId ? variants.find((v) => v.id === routineVariantId) : undefined;
    if (routineVariant) {
      usedRecipeIds.add(routineVariant.recipeId);
      picks[dayKey] = {
        variant: routineVariant,
        reason: `Dit is jullie vaste gewoonte op ${DAY_LABELS[dayKey].toLowerCase()}.`,
        confidence: "CERTAIN",
      };
      continue;
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
        ingredients: candidate.recipe.ingredients.map((ri) => ({
          id: ri.ingredientId,
          name: ri.ingredient.name,
        })),
        variantType: candidate.variantType,
        contextFit: candidate.contextFit,
      })),
      dayKey,
      busy,
      preferredCategories,
      variantPreferences: variantPreferenceById,
      personalVariantPreferences: personalPreferencesForPresentPersons.byVariant,
      personalCategoryPreferences: personalPreferencesForPresentPersons.byCategory,
      personalIngredientPreferences: personalPreferencesForPresentPersons.byIngredient,
      planningStyle: household.planningStyle,
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
      score: scored.score,
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
          source: entrySource,
          status: "PROPOSED",
          reason: picks[dayKey].reason,
          score: picks[dayKey].score ?? null,
          confidenceLevel: picks[dayKey].confidence,
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

/**
 * WP53: als de gebruiker de boodschappenlijst bevestigt zonder een
 * voorgesteld weekmenu-item te wijzigen, telt dat als zachte acceptatie.
 * Dit is bewust idempotent: alleen nog-PROPOSED AUTO/REGENERATED-regels
 * krijgen feedback en worden daarna ACCEPTED.
 */
export async function acceptProposedMealPlanEntries(householdId: string, mealPlanId: string) {
  const mealPlan = await prisma.mealPlan.findFirstOrThrow({
    where: { id: mealPlanId, householdId },
    include: { entries: true },
  });
  const acceptedEntries = entriesForSilentAcceptance(mealPlan.entries);
  if (acceptedEntries.length === 0) {
    await prisma.mealPlan.update({
      where: { id: mealPlan.id },
      data: { status: "GROCERIES_READY" },
    });
    return { acceptedCount: 0 };
  }

  await prisma.$transaction([
    prisma.mealPlan.update({
      where: { id: mealPlan.id },
      data: { status: "GROCERIES_READY" },
    }),
    ...acceptedEntries.map((entry) =>
      prisma.mealPlanEntry.update({
        where: { id: entry.id },
        data: { status: "ACCEPTED" },
      })
    ),
    ...acceptedEntries.map((entry) =>
      prisma.feedbackEvent.create({
        data: {
          householdId,
          subjectType: "RECIPE_VARIANT",
          subjectId: entry.recipeVariantId,
          eventType: "CHOSEN",
          explicit: false,
          context: {
            dayOfWeek: entry.dayOfWeek,
            source: "silent_week_acceptance",
            mealPlanId: mealPlan.id,
          },
        },
      })
    ),
  ]);

  for (const recipeVariantId of new Set(acceptedEntries.map((entry) => entry.recipeVariantId))) {
    await recalculateVariantConfidence(householdId, recipeVariantId);
    await maybePromoteRecipeStatus(recipeVariantId, householdId);
  }

  return { acceptedCount: acceptedEntries.length };
}
