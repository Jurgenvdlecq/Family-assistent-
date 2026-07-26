import type { ConfidenceLevel } from "@/generated/prisma/enums";
import type { DayKey } from "@/lib/week";

type RecipeStatus = "FOUND" | "ADAPTED" | "PROVEN" | "SAFE_CHOICE";
type VariantType = "FAST" | "FRESH" | "REHEATABLE" | "KID_FRIENDLY";
type Stance = "LIKED" | "SOMETIMES" | "RATHER_NOT" | "NEVER" | "UNKNOWN";

export interface MealPlanCandidate {
  id: string;
  recipeId: string;
  recipeTitle: string;
  recipeCategory: string;
  recipeStatus: RecipeStatus;
  recipeProperties: string[];
  variantType: VariantType;
  contextFit: string[];
}

export interface RecipeVariantPreference {
  stance: Stance;
  confidence: number;
}

export interface MealPlanScoringInput {
  candidates: MealPlanCandidate[];
  dayKey: DayKey;
  busy: boolean;
  preferredCategories: Set<string>;
  variantPreferences: Map<string, RecipeVariantPreference>;
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

function scoreCandidate(input: MealPlanScoringInput, candidate: MealPlanCandidate): ScoredMealPlanCandidate {
  const reasons: string[] = [];
  let score = 100;
  let hasDoubt = false;

  const dayLabel = DAY_LABELS[input.dayKey];
  const busyFit = BUSY_VARIANT_TYPES.has(candidate.variantType) || candidate.contextFit.includes("drukke_dag");
  const preferred = input.preferredCategories.has(candidate.recipeCategory);
  const variantPreference = input.variantPreferences.get(candidate.id);
  const lastPlannedAt = input.lastPlannedByRecipeId.get(candidate.recipeId);

  if (input.busy) {
    if (busyFit) {
      score += 25;
      reasons.push(`past bij jullie drukke ${dayLabel}`);
    } else {
      score -= 25;
      hasDoubt = true;
      reasons.push(`is minder vanzelfsprekend op jullie drukke ${dayLabel}`);
    }
  } else if (candidate.variantType === "FRESH") {
    score += 5;
    reasons.push(`er is op ${dayLabel} ruimte voor vers koken`);
  }

  if (input.preferredCategories.size > 0) {
    if (preferred) {
      score += 20;
      reasons.push(`past bij jullie voorkeur voor ${labelCategory(candidate.recipeCategory)}`);
    } else {
      score -= 8;
      hasDoubt = true;
      reasons.push(`valt niet in jullie favoriete categorieën`);
    }
  }

  if (variantPreference?.stance === "LIKED") {
    score += 20 * variantPreference.confidence;
    reasons.push(`is eerder positief beoordeeld`);
  } else if (variantPreference?.stance === "RATHER_NOT") {
    score -= 25 * Math.max(0.5, variantPreference.confidence);
    hasDoubt = true;
    reasons.push(`is eerder minder goed bevallen`);
  } else if (variantPreference?.stance === "NEVER") {
    score -= 60;
    hasDoubt = true;
    reasons.push(`staat als te vermijden gerechtvariant geregistreerd`);
  }

  if (candidate.recipeStatus === "SAFE_CHOICE") {
    score += 15;
    reasons.push(`is al een veilige keuze voor jullie`);
  } else if (candidate.recipeStatus === "PROVEN") {
    score += 10;
    reasons.push(`heeft zich eerder bewezen`);
  }

  if (candidate.variantType === "KID_FRIENDLY" || candidate.contextFit.includes("kindvriendelijk")) {
    score += 8;
    reasons.push(`is kindvriendelijk`);
  }

  if (lastPlannedAt) {
    const daysAgo = daysBetween(lastPlannedAt, input.targetDate);
    if (daysAgo < 14) {
      score -= 20;
      hasDoubt = true;
      reasons.push(`stond ${daysAgo} dagen geleden nog op de planning`);
    } else if (daysAgo >= 35) {
      score += 8;
      reasons.push(`is al langer niet gepland`);
    }
  } else {
    score += 4;
    reasons.push(`brengt afwisseling in de week`);
  }

  if (input.usedRecipeIds.has(candidate.recipeId)) {
    score -= 50;
    hasDoubt = true;
    reasons.push(`dit recept staat deze week al een keer op tafel`);
  }

  return {
    candidate,
    score,
    confidence: hasDoubt ? "SLIGHT_DOUBT" : "CERTAIN",
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
