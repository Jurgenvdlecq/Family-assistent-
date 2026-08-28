import { prisma } from "./prisma";
import { logFeedbackEvent } from "./feedback";
import { recalculateVariantConfidence, maybePromoteRecipeStatus } from "./scoring";
import { DAY_KEYS, DAY_ENUM, DAY_KEY_BY_ENUM, DAY_LABELS, dateForDay, type DayKey } from "./week";
import { getHouseholdHardRestrictionsAndParticipantsForWeek } from "./household";
import { recipeConflictsWithRestrictions } from "./dietaryRestrictions";
import { accessibleRecipeWhere } from "./recipeScope";
import {
  chooseMealPlanCandidate,
  formatMealPlanReason,
  type ConfirmedCategoryDayPattern,
  type PersonalRecipeVariantPreference,
  type PersonalSubjectPreference,
} from "@/domain/meal-planning/scoreMealPlanCandidate";
import { dayRecipePreferenceOwnerId } from "@/domain/meal-planning/dayRecipePreferences";
import { dayProfile } from "@/domain/meal-planning/dayProfiles";
import { resolveMealDayRule } from "@/domain/meal-planning/mealDayRules";
import { chooseComponents, describeComponentChoice } from "@/domain/meal-planning/mealComposition";
import { entriesForSilentAcceptance } from "@/domain/meal-planning/silentAcceptance";
import { recordRepeatedMealAcceptance } from "@/domain/learning/patterns";
import type { ConfidenceLevel } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { logEvent, createCorrelationId, errorMessage } from "./logger";

type WeeklyRhythm = Partial<Record<DayKey, "busy" | "quiet">>;

const BUSY_VARIANT_TYPES = new Set(["FAST", "REHEATABLE"]);
const RECENT_PLANNING_WINDOW_DAYS = 56;

function contextHasConfirmedAlwaysUse(value: unknown) {
  const context = value as { confirmedReason?: unknown } | null;
  return (
    context !== null &&
    typeof context === "object" &&
    context.confirmedReason === "ALWAYS_USE"
  );
}

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
      // Een avond kan ook een samenstelling zijn; dan zit de maaltijd in de
      // gekozen componenten in plaats van in een recept.
      mealTemplate: true,
      components: { include: { option: { include: { group: true, ingredient: true } } } },
      // Ook een verdeelde avond hoort hier compleet uit te komen: anders zou
      // een scherm de naam van het onderliggende gerecht tonen in plaats van
      // de delen die er echt op tafel staan.
      assignments: { include: { persons: true, items: true } },
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
 *
 * Dunne wrapper om `ensureMealPlanInner` (Fase 16): logt begin/einde van een
 * daadwerkelijke generatie met een correlation-ID, en logt+rethrowt bij een
 * fout, zonder de interne functie zelf te hoeven doorspekken met try/catch.
 */
export async function ensureMealPlan(
  householdId: string,
  weekStart: Date,
  entrySource: "AUTO" | "REGENERATED" = "AUTO"
) {
  const correlationId = createCorrelationId();
  const startedAt = Date.now();
  try {
    return await ensureMealPlanInner(householdId, weekStart, entrySource, correlationId, startedAt);
  } catch (error) {
    logEvent({
      level: "error",
      area: "meal_plan",
      message: "Weekplanning genereren mislukt",
      correlationId,
      meta: {
        householdId,
        weekStart: weekStart.toISOString(),
        entrySource,
        durationMs: Date.now() - startedAt,
        error: errorMessage(error),
      },
    });
    throw error;
  }
}

async function ensureMealPlanInner(
  householdId: string,
  weekStart: Date,
  entrySource: "AUTO" | "REGENERATED",
  correlationId: string,
  startedAt: number
) {
  const existing = await getMealPlanForWeek(householdId, weekStart);
  if (existing) return existing;

  logEvent({
    level: "info",
    area: "meal_plan",
    message: "Weekplanning genereren gestart",
    correlationId,
    meta: { householdId, weekStart: weekStart.toISOString(), entrySource },
  });

  const recentPlanningStart = new Date(weekStart);
  recentPlanningStart.setDate(recentPlanningStart.getDate() - RECENT_PLANNING_WINDOW_DAYS);
  const previousWeekStart = new Date(weekStart);
  previousWeekStart.setDate(previousWeekStart.getDate() - 7);

  const [
    household,
    preferences,
    variantPreferences,
    dayRecipePreferences,
    recentSuggestions,
    allVariants,
    { hardRestrictionsByDay, participantsByDay },
    dayRoutines,
    mealDayRules,
    externalFulfillments,
    mealTemplates,
    recentComponentChoices,
    previousWeekEntries,
    confirmedAcceptancePatterns,
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
    prisma.preference.findMany({
      where: {
        ownerType: "HOUSEHOLD",
        ownerId: { in: DAY_KEYS.map((dayKey) => dayRecipePreferenceOwnerId(householdId, dayKey)) },
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
    // Aanwezigheid van déze week: het oneven/even-ritme en
    // datum-uitzonderingen maken dat een weekdag alleen samen met een
    // concrete week betekenis heeft.
    getHouseholdHardRestrictionsAndParticipantsForWeek(householdId, weekStart),
    prisma.dayRoutine.findMany({ where: { householdId } }),
    prisma.mealDayRule.findMany({ where: { householdId } }),
    prisma.householdIngredientFulfillment.findMany({
      where: { householdId, fulfillment: { not: "PICNIC" } },
      select: { ingredientId: true },
    }),
    prisma.mealTemplate.findMany({
      where: { householdId },
      include: {
        groups: {
          include: { options: { include: { ingredient: true } } },
          orderBy: { sortOrder: "asc" },
        },
      },
    }),
    // Welke componenten er de afgelopen weken gekozen zijn — de basis voor
    // afwisseling ("vorige week broccoli, dus nu sperziebonen").
    prisma.mealPlanEntryComponent.findMany({
      where: { mealPlanEntry: { mealPlan: { householdId, weekStart: { lt: weekStart, gte: recentPlanningStart } } } },
      select: { mealComponentOptionId: true, mealPlanEntry: { select: { mealPlan: { select: { weekStart: true } } } } },
    }),
    // De maaltijden van vorige week — nodig voor een dagprofiel dat "dit
    // varieert niet vanzelf" zegt zonder dat er een exact gerecht aan hangt.
    prisma.mealPlanEntry.findMany({
      where: { mealPlan: { householdId, weekStart: previousWeekStart } },
      select: { dayOfWeek: true, recipeVariantId: true },
    }),

    prisma.learnedPattern.findMany({
      where: {
        householdId,
        patternType: "MEAL_CATEGORY_ACCEPTED_ON_DAY",
        subjectType: "RECIPE_CATEGORY",
        status: "CONFIRMED",
        contextKey: { in: DAY_KEYS.map((dayKey) => `day:${DAY_ENUM[dayKey]}`) },
      },
      select: { subjectId: true, contextKey: true, context: true, confidence: true },
    }),
  ]);
  const dayRoutineByDay = new Map(
    dayRoutines.map((routine) => [DAY_KEY_BY_ENUM[routine.dayOfWeek], routine.recipeVariantId])
  );
  const previousWeekVariantByDay = new Map(
    previousWeekEntries
      .filter((entry) => entry.recipeVariantId !== null)
      .map((entry) => [DAY_KEY_BY_ENUM[entry.dayOfWeek], entry.recipeVariantId!])
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
          hardRestrictionsByDay[dayKey] ?? []
        )
    );

  const preferredCategories = new Set(preferences.map((p) => p.subjectId));
  const variantPreferenceById = new Map(
    variantPreferences.map((preference) => [
      preference.subjectId,
      { stance: preference.stance, confidence: preference.confidence },
    ])
  );
  // Fase 11: na herhaalde negatieve feedback (src/domain/learning/hiddenRecipes.ts)
  // wordt een gerecht ook niet meer automatisch voor een nieuwe week
  // voorgesteld — dezelfde uitsluiting als op /gerechten.
  const hiddenVariantIds = new Set(
    variantPreferences.filter((preference) => preference.hiddenAt !== null).map((preference) => preference.subjectId)
  );
  const dayRecipePreferencesByDay = new Map<DayKey, Map<string, { stance: typeof dayRecipePreferences[number]["stance"]; confidence: number }>>();
  for (const dayKey of DAY_KEYS) {
    const ownerId = dayRecipePreferenceOwnerId(householdId, dayKey);
    const preferencesForDay = dayRecipePreferences.filter((preference) => preference.ownerId === ownerId);
    dayRecipePreferencesByDay.set(
      dayKey,
      new Map(
        preferencesForDay.map((preference) => [
          preference.subjectId,
          { stance: preference.stance, confidence: preference.confidence },
        ])
      )
    );
  }
  const lastPlannedByRecipeId = new Map<string, Date>();
  for (const suggestion of recentSuggestions) {
    if (!lastPlannedByRecipeId.has(suggestion.recipeVariant.recipeId)) {
      lastPlannedByRecipeId.set(suggestion.recipeVariant.recipeId, suggestion.targetSlot);
    }
  }
  const rhythm = (household.weeklyRhythm ?? {}) as unknown as WeeklyRhythm;
  const confirmedCategoryPatternsByDay = new Map<DayKey, Map<string, ConfirmedCategoryDayPattern>>();
  for (const pattern of confirmedAcceptancePatterns) {
    if (!pattern.subjectId || !contextHasConfirmedAlwaysUse(pattern.context)) continue;
    const dayKey = DAY_KEYS.find((key) => pattern.contextKey === `day:${DAY_ENUM[key]}`);
    if (!dayKey) continue;
    const dayPatterns = confirmedCategoryPatternsByDay.get(dayKey) ?? new Map<string, ConfirmedCategoryDayPattern>();
    dayPatterns.set(pattern.subjectId, { confidence: pattern.confidence });
    confirmedCategoryPatternsByDay.set(dayKey, dayPatterns);
  }

  const usedRecipeIds = new Set<string>();
  type VariantWithRecipe = (typeof allVariants)[number];
  // Een avond is óf een recept, óf een samenstelling uit componenten. Bewust
  // een unie en geen "variant mag null zijn": zo kan er geen halve avond
  // ontstaan die geen van beide is.
  type Pick =
    | { kind: "recipe"; variant: VariantWithRecipe; reason: string; confidence: ConfidenceLevel; score?: number }
    | { kind: "composite"; templateId: string; optionIds: string[]; reason: string; confidence: ConfidenceLevel };
  const picks = {} as Record<DayKey, Pick>;

  const templatesById = new Map(mealTemplates.map((template) => [template.id, template]));
  // Ingrediënten die dit huishouden niet via Picnic haalt — dat maakt een
  // gerecht niet onmogelijk, wel iets minder vanzelfsprekend.
  const externalIngredientIds = new Set(externalFulfillments.map((entry) => entry.ingredientId));
  // Hoe recent een component gekozen is, als volgnummer: 0 = de meest recente
  // week waarin hij voorkwam.
  const weeksDescending = [
    ...new Set(recentComponentChoices.map((choice) => choice.mealPlanEntry.mealPlan.weekStart.getTime())),
  ].sort((a, b) => b - a);
  const recencyByOptionId = new Map<string, number>();
  for (const choice of recentComponentChoices) {
    const rank = weeksDescending.indexOf(choice.mealPlanEntry.mealPlan.weekStart.getTime());
    const known = recencyByOptionId.get(choice.mealComponentOptionId);
    if (known === undefined || rank < known) recencyByOptionId.set(choice.mealComponentOptionId, rank);
  }
  // Binnen déze week mag dezelfde optie niet twee keer terugkomen — dat is de
  // eis "dinsdag en vrijdag niet dezelfde combinatie".
  const usedOptionIdsThisWeek = new Set<string>();

  for (const dayKey of DAY_KEYS) {
    const busy = rhythm[dayKey] === "busy";
    const targetDate = dateForDay(weekStart, dayKey);
    // Het weekritme van dit huishouden voor déze datum (oneven/even).
    // `null` bij een huishouden dat niets heeft ingesteld — dan verloopt
    // alles hieronder precies zoals vóór het weekritme.
    const rule = resolveMealDayRule(mealDayRules, DAY_ENUM[dayKey], targetDate);
    const profile = dayProfile(rule?.profileKey);
    const personalPreferencesForPresentPersons = personalPreferencesForDay(dayKey);
    const variants = safeVariantsForDay(dayKey).filter(
      (variant) =>
        !candidateHasNeverPreference(variant, personalPreferencesForPresentPersons) &&
        !hiddenVariantIds.has(variant.id)
    );
    if (variants.length === 0) {
      throw new Error(
        `Geen enkel gerecht in de bibliotheek voldoet aan de harde beperkingen voor ${DAY_ENUM[dayKey]}. Voeg geschikte recepten toe voordat er een weekplanning gemaakt kan worden.`
      );
    }

    // Een vaste maaltijd uit het weekritme (bijvoorbeeld de patatdag) gaat
    // vóór de gewone scoring — maar net als bij een daggewoonte alleen zolang
    // hij veilig is: `variants` is al gefilterd op harde beperkingen en
    // NEVER-voorkeuren, dus een gerecht dat daar niet doorheen komt staat hier
    // simpelweg niet meer in en de dag valt terug op scoring.
    const fixedVariant = rule?.fixedRecipeVariantId
      ? variants.find((variant) => variant.id === rule.fixedRecipeVariantId)
      : undefined;
    if (fixedVariant) {
      usedRecipeIds.add(fixedVariant.recipeId);
      picks[dayKey] = {
        kind: "recipe",
        variant: fixedVariant,
        reason: `Dit staat vast op ${DAY_LABELS[dayKey].toLowerCase()}.`,
        confidence: "CERTAIN",
      };
      continue;
    }

    // Zegt de dagregel "stel deze avond samen" (zoals een AVG-avond), dan
    // kiest de planner per component een optie in plaats van één recept.
    //
    // Componenten gaan langs dezelfde harde-beperkingenfilter als recepten:
    // een allergie is een allergie, ook als het onderdeel maar één van de drie
    // is. Blijft er van een component niets veilig over, dan wordt die
    // component overgeslagen; blijft er van de hele maaltijd niets over, dan
    // valt de dag terug op een gewoon recept — een halve maaltijd tonen zou
    // beloven wat er niet is.
    const template = rule?.mealTemplateId ? templatesById.get(rule.mealTemplateId) : undefined;
    if (template) {
      const safeGroups = template.groups
        .map((group) => ({
          id: group.id,
          role: group.role as string,
          name: group.name,
          sortOrder: group.sortOrder,
          options: group.options
            .filter(
              (option) =>
                !recipeConflictsWithRestrictions(
                  [{ category: option.ingredient.category, restrictionTags: option.ingredient.restrictionTags }],
                  hardRestrictionsByDay[dayKey] ?? []
                )
            )
            .map((option) => ({ id: option.id, name: option.name, ingredientId: option.ingredientId })),
        }))
        .filter((group) => group.options.length > 0);

      if (safeGroups.length > 0) {
        const choices = chooseComponents({
          groups: safeGroups,
          usedThisWeek: usedOptionIdsThisWeek,
          recencyByOptionId,
        });
        for (const choice of choices) usedOptionIdsThisWeek.add(choice.option.id);
        picks[dayKey] = {
          kind: "composite",
          templateId: template.id,
          optionIds: choices.map((choice) => choice.option.id),
          reason: describeComponentChoice(template.name, choices),
          confidence: "CERTAIN",
        };
        continue;
      }
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
        kind: "recipe",
        variant: routineVariant,
        reason: `Dit is jullie vaste gewoonte op ${DAY_LABELS[dayKey].toLowerCase()}.`,
        confidence: "CERTAIN",
      };
      continue;
    }

    // Een dagprofiel kan ook zeggen "deze avond varieert niet vanzelf" zónder
    // dat er een exact gerecht bij hoort. Dan is "hetzelfde als vorige week"
    // de enige eerlijke invulling van die belofte: wél stabiel, en nog steeds
    // door de gebruiker te wijzigen. Bestaat er geen vorige week (of is dat
    // gerecht inmiddels onveilig), dan valt de dag gewoon terug op scoring —
    // dat is beter dan een lege avond.
    if (profile?.fixed) {
      const previousVariantId = previousWeekVariantByDay.get(dayKey);
      const previousVariant = previousVariantId
        ? variants.find((variant) => variant.id === previousVariantId)
        : undefined;
      if (previousVariant) {
        usedRecipeIds.add(previousVariant.recipeId);
        picks[dayKey] = {
          kind: "recipe",
          variant: previousVariant,
          reason: `${DAY_LABELS[dayKey]} houden jullie hetzelfde.`,
          confidence: "CERTAIN",
        };
        continue;
      }
    }

    const notUsedYet = variants.filter((v) => !usedRecipeIds.has(v.recipeId));
    const pool = notUsedYet.length > 0 ? notUsedYet : variants;

    const matchesBusy = (v: VariantWithRecipe) =>
      busy ? BUSY_VARIANT_TYPES.has(v.variantType) || v.contextFit.includes("drukke_dag") : true;
    const matchesPreference = (v: VariantWithRecipe) =>
      preferredCategories.size === 0 || preferredCategories.has(v.recipe.category);

    // Een dagregel mag ook "kies uit deze categorie" zeggen in plaats van een
    // exact gerecht. Bewust een voorkeursfilter en geen harde eis: is er in
    // die categorie niets bruikbaars, dan is een passend gerecht uit een
    // andere categorie beter dan geen maaltijd.
    const matchesRuleCategory = (v: VariantWithRecipe) =>
      !rule?.preferredCategory || v.recipe.category === rule.preferredCategory;

    let candidates = pool.filter((v) => matchesBusy(v) && matchesPreference(v) && matchesRuleCategory(v));
    let confidence: ConfidenceLevel = "CERTAIN";
    if (candidates.length === 0 && rule?.preferredCategory) {
      candidates = pool.filter((v) => matchesBusy(v) && matchesRuleCategory(v));
      confidence = "SLIGHT_DOUBT";
    }
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
      dayRecipePreferences: dayRecipePreferencesByDay.get(dayKey),
      confirmedCategoryDayPatterns: confirmedCategoryPatternsByDay.get(dayKey),
      personalVariantPreferences: personalPreferencesForPresentPersons.byVariant,
      personalCategoryPreferences: personalPreferencesForPresentPersons.byCategory,
      personalIngredientPreferences: personalPreferencesForPresentPersons.byIngredient,
      planningStyle: household.planningStyle,
      dayProfile: profile,
      externalIngredientIds,
      lastPlannedByRecipeId,
      usedRecipeIds,
      targetDate,
    });
    const chosen = candidates.find((candidate) => candidate.id === scored.candidate.id)!;
    usedRecipeIds.add(chosen.recipeId);

    picks[dayKey] = {
      kind: "recipe",
      variant: chosen,
      reason: formatMealPlanReason(scored),
      confidence: confidence === "SLIGHT_DOUBT" ? confidence : scored.confidence,
      score: scored.score,
    };
  }

  try {
    await prisma.mealPlan.create({
      data: {
        householdId,
        weekStart,
        status: "CONFIRMED",
        entries: {
          create: DAY_KEYS.map((dayKey) => {
            const pick = picks[dayKey];
            return {
              dayOfWeek: DAY_ENUM[dayKey],
              recipeVariantId: pick.kind === "recipe" ? pick.variant.id : null,
              mealTemplateId: pick.kind === "composite" ? pick.templateId : null,
              components:
                pick.kind === "composite"
                  ? { create: pick.optionIds.map((optionId) => ({ mealComponentOptionId: optionId })) }
                  : undefined,
              source: entrySource,
              status: "PROPOSED" as const,
              reason: pick.reason,
              score: pick.kind === "recipe" ? pick.score ?? null : null,
              confidenceLevel: pick.confidence,
            };
          }),
        },
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Twee bijna-gelijktijdige aanvragen voor dezelfde week (bijv. dubbele
      // paginaverzoeken): een andere aanvraag heeft de weekplanning net
      // aangemaakt. Geen dubbele suggesties/feedback aanmaken, gewoon het
      // resultaat van de winnaar teruggeven i.p.v. crashen op de unique
      // constraint (household_id, week_start).
      logEvent({
        level: "info",
        area: "meal_plan",
        message: "Weekplanning genereren: race met gelijktijdige aanvraag, bestaande planning gebruikt",
        correlationId,
        meta: { householdId, weekStart: weekStart.toISOString(), entrySource },
      });
      const winner = await getMealPlanForWeek(householdId, weekStart);
      if (winner) return winner;
    }
    throw error;
  }

  // Suggesties en feedback gaan over een receptvariant. Een samengestelde
  // avond heeft die niet — daar wordt in werkpakket F apart van geleerd (de
  // componentkeuzes staan al vast in `MealPlanEntryComponent`). Er hier een
  // nepvariant voor verzinnen zou de geschiedenis vervuilen.
  const recipeDays = DAY_KEYS.map((dayKey) => ({ dayKey, pick: picks[dayKey] })).filter(
    (day): day is { dayKey: DayKey; pick: Extract<Pick, { kind: "recipe" }> } => day.pick.kind === "recipe"
  );

  await prisma.mealSuggestion.createMany({
    data: recipeDays.map(({ dayKey, pick }) => ({
      householdId,
      recipeVariantId: pick.variant.id,
      reason: pick.reason,
      confidenceLevel: pick.confidence,
      targetSlot: dateForDay(weekStart, dayKey),
    })),
  });

  for (const { dayKey, pick } of recipeDays) {
    await logFeedbackEvent({
      householdId,
      subjectType: "RECIPE_VARIANT",
      subjectId: pick.variant.id,
      eventType: "CHOSEN",
      explicit: false,
      context: {
        dayOfWeek: DAY_ENUM[dayKey],
        busy: rhythm[dayKey] === "busy",
        source: "auto_generated",
      },
    });
    await recalculateVariantConfidence(householdId, pick.variant.id);
    await maybePromoteRecipeStatus(pick.variant.id, householdId);
  }

  logEvent({
    level: "info",
    area: "meal_plan",
    message: "Weekplanning gegenereerd",
    correlationId,
    meta: { householdId, weekStart: weekStart.toISOString(), entrySource, durationMs: Date.now() - startedAt },
  });

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
    include: { entries: { include: { recipeVariant: { include: { recipe: { select: { category: true, title: true } } } } } } },
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
    ...acceptedEntries
      .filter((entry) => entry.recipeVariantId !== null)
      .map((entry) =>
      prisma.feedbackEvent.create({
        data: {
          householdId,
          subjectType: "RECIPE_VARIANT",
          subjectId: entry.recipeVariantId!,
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

  // Alleen receptavonden leveren iets op om van te leren: een samengestelde
  // maaltijd heeft geen variant waar vertrouwen aan hangt. De status van zo'n
  // avond wordt hierboven wél netjes op ACCEPTED gezet, zodat de weekplanning
  // niet half PROPOSED blijft staan.
  const acceptedRecipeEntries = acceptedEntries.filter(
    (entry): entry is (typeof acceptedEntries)[number] & { recipeVariantId: string } =>
      entry.recipeVariantId !== null && entry.recipeVariant !== null
  );
  for (const recipeVariantId of new Set(acceptedRecipeEntries.map((entry) => entry.recipeVariantId))) {
    await recalculateVariantConfidence(householdId, recipeVariantId);
    await maybePromoteRecipeStatus(recipeVariantId, householdId);
  }
  for (const entry of acceptedRecipeEntries) {
    await recordRepeatedMealAcceptance({
      householdId,
      dayOfWeek: entry.dayOfWeek,
      acceptedRecipeVariantId: entry.recipeVariantId,
      acceptedRecipeCategory: entry.recipeVariant!.recipe.category,
      acceptedRecipeTitle: entry.recipeVariant!.recipe.title,
    });
  }

  return { acceptedCount: acceptedEntries.length };
}
