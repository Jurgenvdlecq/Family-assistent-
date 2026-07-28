import type { ConfidenceLevel } from "@/generated/prisma/enums";
import type { DayKey } from "@/lib/week";
import { tagsForMealCandidate } from "@/domain/meal-tags/mealTags";

type RecipeStatus = "FOUND" | "ADAPTED" | "PROVEN" | "SAFE_CHOICE";
type VariantType = "FAST" | "FRESH" | "REHEATABLE" | "KID_FRIENDLY";
type Stance = "LIKED" | "SOMETIMES" | "RATHER_NOT" | "NEVER" | "UNKNOWN";
type PlanningStyle = "SAFE" | "BALANCED" | "ADVENTUROUS";

export interface MealPlanCandidate {
  id: string;
  recipeId: string;
  recipeTitle: string;
  recipeCategory: string;
  recipeStatus: RecipeStatus;
  recipeProperties: string[];
  ingredients: { id: string; name: string }[];
  variantType: VariantType;
  contextFit: string[];
}

export interface RecipeVariantPreference {
  stance: Stance;
  confidence: number;
}

export interface PersonalRecipeVariantPreference extends RecipeVariantPreference {
  personName: string;
}

export interface PersonalSubjectPreference extends RecipeVariantPreference {
  personName: string;
  subjectLabel: string;
}

export interface ConfirmedCategoryDayPattern {
  confidence: number;
}

export interface MealPlanScoringInput {
  candidates: MealPlanCandidate[];
  dayKey: DayKey;
  busy: boolean;
  preferredCategories: Set<string>;
  variantPreferences: Map<string, RecipeVariantPreference>;
  confirmedCategoryDayPatterns?: Map<string, ConfirmedCategoryDayPattern>;
  personalVariantPreferences?: Map<string, PersonalRecipeVariantPreference[]>;
  personalCategoryPreferences?: Map<string, PersonalSubjectPreference[]>;
  personalIngredientPreferences?: Map<string, PersonalSubjectPreference[]>;
  planningStyle?: PlanningStyle;
  lastPlannedByRecipeId: Map<string, Date>;
  usedRecipeIds: Set<string>;
  targetDate: Date;
}

export interface ScoredMealPlanCandidate {
  candidate: MealPlanCandidate;
  score: number;
  confidence: ConfidenceLevel;
  reasons: string[];
}

const BUSY_VARIANT_TYPES = new Set<VariantType>(["FAST", "REHEATABLE"]);
const DAY_LABELS: Record<DayKey, string> = {
  monday: "maandag",
  tuesday: "dinsdag",
  wednesday: "woensdag",
  thursday: "donderdag",
  friday: "vrijdag",
  saturday: "zaterdag",
  sunday: "zondag",
};

const CATEGORY_LABELS: Record<string, string> = {
  PASTA: "pasta",
  WRAPS: "wraps",
  RICE_DISH: "rijstgerechten",
  ALL_VEGGIE_DAY: "vegetarische dagen",
  QUICK_AND_EASY: "snelle gerechten",
  COMFORT_FOOD: "comfort food",
  AIRFRYER: "airfryer-gerechten",
  OTHER: "afwisseling",
};

function labelCategory(category: string): string {
  return CATEGORY_LABELS[category] ?? category.toLowerCase().replaceAll("_", " ");
}

function daysBetween(from: Date, to: Date): number {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.floor((to.getTime() - from.getTime()) / dayMs);
}

function applyPersonalSignal(
  signal: {
    score: number;
    hasDoubt: boolean;
    reasons: string[];
  },
  preferences: PersonalSubjectPreference[],
  label: string
) {
  const favorites = preferences.filter((preference) => preference.stance === "LIKED");
  const lightOk = preferences.filter((preference) => preference.stance === "SOMETIMES");
  const dislikes = preferences.filter((preference) => preference.stance === "RATHER_NOT");
  const never = preferences.filter((preference) => preference.stance === "NEVER");

  if (favorites.length > 0) {
    signal.score += favorites.reduce((sum, preference) => sum + 10 * preference.confidence, 0);
    signal.reasons.push(
      `${favorites.map((preference) => preference.personName).join(", ")} houdt van ${label}`
    );
  }
  if (lightOk.length > 0) {
    signal.score += lightOk.reduce((sum, preference) => sum + 3 * preference.confidence, 0);
  }
  if (dislikes.length > 0) {
    signal.score -= dislikes.reduce((sum, preference) => sum + 22 * Math.max(0.5, preference.confidence), 0);
    signal.hasDoubt = true;
    signal.reasons.push(
      `${dislikes.map((preference) => preference.personName).join(", ")} eet ${label} liever niet`
    );
  }
  if (never.length > 0) {
    signal.score -= 100;
    signal.hasDoubt = true;
    signal.reasons.push(
      `${never.map((preference) => preference.personName).join(", ")} wil ${label} nooit`
    );
  }
}

function scoreCandidate(input: MealPlanScoringInput, candidate: MealPlanCandidate): ScoredMealPlanCandidate {
  const reasons: string[] = [];
  const signal = { score: 100, hasDoubt: false, reasons };

  const dayLabel = DAY_LABELS[input.dayKey];
  const candidateTags = new Set(
    tagsForMealCandidate({
      recipeCategory: candidate.recipeCategory,
      recipeProperties: candidate.recipeProperties,
      variantType: candidate.variantType,
      contextFit: candidate.contextFit,
      ingredients: candidate.ingredients,
    })
  );
  const busyFit = candidateTags.has("FAST") || candidateTags.has("LOW_EFFORT") || BUSY_VARIANT_TYPES.has(candidate.variantType);
  const preferred = input.preferredCategories.has(candidate.recipeCategory);
  const variantPreference = input.variantPreferences.get(candidate.id);
  const confirmedCategoryDayPattern = input.confirmedCategoryDayPatterns?.get(candidate.recipeCategory);
  const personalPreferences = input.personalVariantPreferences?.get(candidate.id) ?? [];
  const lastPlannedAt = input.lastPlannedByRecipeId.get(candidate.recipeId);
  const planningStyle = input.planningStyle ?? "BALANCED";

  if (input.busy) {
    if (busyFit) {
      signal.score += 25;
      reasons.push(`past bij jullie drukke ${dayLabel}`);
    } else {
      signal.score -= 25;
      signal.hasDoubt = true;
      reasons.push(`is minder vanzelfsprekend op jullie drukke ${dayLabel}`);
    }
  } else if (candidate.variantType === "FRESH") {
    signal.score += 5;
    reasons.push(`er is op ${dayLabel} ruimte voor vers koken`);
  }

  if (input.preferredCategories.size > 0) {
    if (preferred) {
      signal.score += 20;
      reasons.push(`past bij jullie voorkeur voor ${labelCategory(candidate.recipeCategory)}`);
    } else {
      signal.score -= 8;
      signal.hasDoubt = true;
      reasons.push(`valt niet in jullie favoriete categorieën`);
    }
  }

  if (confirmedCategoryDayPattern) {
    signal.score += 18 * Math.max(0.5, confirmedCategoryDayPattern.confidence);
    reasons.push(`past bij wat jullie vaker op ${dayLabel} willen eten`);
  }

  if (variantPreference?.stance === "LIKED") {
    signal.score += 20 * variantPreference.confidence;
    reasons.push(`is eerder positief beoordeeld`);
  } else if (variantPreference?.stance === "RATHER_NOT") {
    signal.score -= 25 * Math.max(0.5, variantPreference.confidence);
    signal.hasDoubt = true;
    reasons.push(`is eerder minder goed bevallen`);
  } else if (variantPreference?.stance === "NEVER") {
    signal.score -= 60;
    signal.hasDoubt = true;
    reasons.push(`staat als te vermijden gerechtvariant geregistreerd`);
  }

  const favorites = personalPreferences.filter((preference) => preference.stance === "LIKED");
  const lightOk = personalPreferences.filter((preference) => preference.stance === "SOMETIMES");
  const dislikes = personalPreferences.filter((preference) => preference.stance === "RATHER_NOT");
  const never = personalPreferences.filter((preference) => preference.stance === "NEVER");

  if (favorites.length > 0) {
    const boost = favorites.reduce((sum, preference) => sum + 14 * preference.confidence, 0);
    signal.score += boost;
    reasons.push(`${favorites.map((preference) => preference.personName).join(", ")} vindt dit favoriet`);
  }
  if (lightOk.length > 0) {
    signal.score += lightOk.reduce((sum, preference) => sum + 4 * preference.confidence, 0);
  }
  if (dislikes.length > 0) {
    const penalty = dislikes.reduce((sum, preference) => sum + 35 * Math.max(0.5, preference.confidence), 0);
    signal.score -= penalty;
    signal.hasDoubt = true;
    reasons.push(`${dislikes.map((preference) => preference.personName).join(", ")} eet dit liever niet`);
  }
  if (never.length > 0) {
    signal.score -= 120;
    signal.hasDoubt = true;
    reasons.push(`${never.map((preference) => preference.personName).join(", ")} wil dit nooit eten`);
  }

  applyPersonalSignal(
    signal,
    input.personalCategoryPreferences?.get(candidate.recipeCategory) ?? [],
    labelCategory(candidate.recipeCategory)
  );
  for (const ingredient of candidate.ingredients) {
    applyPersonalSignal(
      signal,
      input.personalIngredientPreferences?.get(ingredient.id) ?? [],
      ingredient.name.toLowerCase()
    );
  }

  if (candidate.recipeStatus === "SAFE_CHOICE") {
    signal.score += 15;
    reasons.push(`is al een veilige keuze voor jullie`);
  } else if (candidate.recipeStatus === "PROVEN") {
    signal.score += 10;
    reasons.push(`heeft zich eerder bewezen`);
  }

  if (planningStyle === "SAFE") {
    if (candidate.recipeStatus === "SAFE_CHOICE" || candidate.recipeStatus === "PROVEN") {
      signal.score += 14;
      reasons.push("past bij veilig beginnen");
    } else {
      signal.score -= 8;
      signal.hasDoubt = true;
    }
  } else if (planningStyle === "ADVENTUROUS") {
    if (candidate.recipeStatus === "FOUND") {
      signal.score += 12;
      reasons.push("past bij meer nieuwe suggesties proberen");
    }
    if (lastPlannedAt) signal.score -= 6;
  }

  if (candidateTags.has("KID_FRIENDLY")) {
    signal.score += 8;
    reasons.push(`is kindvriendelijk`);
  }

  if (lastPlannedAt) {
    const daysAgo = daysBetween(lastPlannedAt, input.targetDate);
    if (daysAgo < 14) {
      signal.score -= 20;
      signal.hasDoubt = true;
      reasons.push(`stond ${daysAgo} dagen geleden nog op de planning`);
    } else if (daysAgo >= 35) {
      signal.score += 8;
      reasons.push(`is al langer niet gepland`);
    }
  } else {
    signal.score += 4;
    reasons.push(`brengt afwisseling in de week`);
  }

  if (input.usedRecipeIds.has(candidate.recipeId)) {
    signal.score -= 50;
    signal.hasDoubt = true;
    reasons.push(`dit recept staat deze week al een keer op tafel`);
  }

  return {
    candidate,
    score: signal.score,
    confidence: signal.hasDoubt ? "SLIGHT_DOUBT" : "CERTAIN",
    reasons,
  };
}

export function chooseMealPlanCandidate(input: MealPlanScoringInput): ScoredMealPlanCandidate {
  if (input.candidates.length === 0) {
    throw new Error("Kan geen weekplanningkeuze maken zonder kandidaten.");
  }

  return input.candidates
    .map((candidate) => scoreCandidate(input, candidate))
    .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id))[0];
}

export function formatMealPlanReason(scored: ScoredMealPlanCandidate): string {
  const [firstReason, ...otherReasons] = scored.reasons;
  if (!firstReason) return `${scored.candidate.recipeTitle} is gekozen als stabiele suggestie voor deze dag.`;

  const rest = otherReasons.slice(0, 2);
  const explanation = [firstReason, ...rest].join(", ");
  return `${scored.candidate.recipeTitle} is gekozen: ${explanation}.`;
}
