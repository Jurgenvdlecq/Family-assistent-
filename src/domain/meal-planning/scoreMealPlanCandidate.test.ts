import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseMealPlanCandidate,
  formatMealPlanReason,
  type MealPlanCandidate,
} from "./scoreMealPlanCandidate";

const TARGET_DATE = new Date("2026-07-28T00:00:00Z");

function candidate(overrides: Partial<MealPlanCandidate> & { id: string; recipeId?: string }): MealPlanCandidate {
  const { id, recipeId, ...rest } = overrides;
  return {
    id,
    recipeId: recipeId ?? id,
    recipeTitle: "Pasta pesto",
    recipeCategory: "PASTA",
    recipeStatus: "FOUND",
    recipeProperties: [],
    ingredients: [],
    variantType: "FRESH",
    contextFit: [],
    ...rest,
  };
}

test("kiest op een drukke dag deterministisch de snel passende variant", () => {
  const slow = candidate({ id: "slow", variantType: "FRESH" });
  const fast = candidate({ id: "fast", variantType: "FAST", recipeTitle: "Snelle wraps" });

  const result = chooseMealPlanCandidate({
    candidates: [slow, fast],
    dayKey: "tuesday",
    busy: true,
    preferredCategories: new Set(),
    variantPreferences: new Map(),
    lastPlannedByRecipeId: new Map(),
    usedRecipeIds: new Set(),
    targetDate: TARGET_DATE,
  });

  assert.equal(result.candidate.id, "fast");
  assert.ok(result.reasons.some((reason) => reason.includes("drukke dinsdag")));
});

test("gelijke scores krijgen een stabiele tiebreak op variant-id", () => {
  const result = chooseMealPlanCandidate({
    candidates: [candidate({ id: "z-variant" }), candidate({ id: "a-variant" })],
    dayKey: "monday",
    busy: false,
    preferredCategories: new Set(),
    variantPreferences: new Map(),
    lastPlannedByRecipeId: new Map(),
    usedRecipeIds: new Set(),
    targetDate: TARGET_DATE,
  });

  assert.equal(result.candidate.id, "a-variant");
});

test("recente planning weegt negatief zodat er meer variatie ontstaat", () => {
  const recent = candidate({ id: "recent", recipeId: "same-again", recipeTitle: "Pasta opnieuw" });
  const fresh = candidate({ id: "fresh", recipeId: "different", recipeTitle: "Rijst met groenten" });

  const result = chooseMealPlanCandidate({
    candidates: [recent, fresh],
    dayKey: "wednesday",
    busy: false,
    preferredCategories: new Set(),
    variantPreferences: new Map(),
    lastPlannedByRecipeId: new Map([["same-again", new Date("2026-07-24T00:00:00Z")]]),
    usedRecipeIds: new Set(),
    targetDate: TARGET_DATE,
  });

  assert.equal(result.candidate.id, "fresh");
  assert.equal(result.confidence, "CERTAIN");
});

test("veilige planningsstijl geeft bewezen gerechten voorrang", () => {
  const unknown = candidate({ id: "unknown", recipeStatus: "FOUND", recipeTitle: "Nieuwe curry" });
  const proven = candidate({ id: "proven", recipeStatus: "PROVEN", recipeTitle: "Bewezen pasta" });

  const result = chooseMealPlanCandidate({
    candidates: [unknown, proven],
    dayKey: "monday",
    busy: false,
    preferredCategories: new Set(),
    variantPreferences: new Map(),
    planningStyle: "SAFE",
    lastPlannedByRecipeId: new Map(),
    usedRecipeIds: new Set(),
    targetDate: TARGET_DATE,
  });

  assert.equal(result.candidate.id, "proven");
  assert.ok(result.reasons.some((reason) => reason.includes("veilig beginnen")));
});

test("nieuwsgierige planningsstijl geeft nieuwe suggesties ruimte", () => {
  const proven = candidate({ id: "proven", recipeStatus: "PROVEN", recipeTitle: "Bewezen pasta" });
  const fresh = candidate({ id: "fresh", recipeStatus: "FOUND", recipeTitle: "Nieuwe curry" });

  const result = chooseMealPlanCandidate({
    candidates: [proven, fresh],
    dayKey: "monday",
    busy: false,
    preferredCategories: new Set(),
    variantPreferences: new Map(),
    planningStyle: "ADVENTUROUS",
    lastPlannedByRecipeId: new Map(),
    usedRecipeIds: new Set(),
    targetDate: TARGET_DATE,
  });

  assert.equal(result.candidate.id, "fresh");
  assert.ok(result.reasons.some((reason) => reason.includes("nieuwe suggesties")));
});

test("negatieve variantvoorkeur verlaagt confidence en geeft een concrete reden", () => {
  const disliked = candidate({ id: "disliked", recipeTitle: "Minder favoriet" });
  const result = chooseMealPlanCandidate({
    candidates: [disliked],
    dayKey: "thursday",
    busy: false,
    preferredCategories: new Set(["PASTA"]),
    variantPreferences: new Map([["disliked", { stance: "RATHER_NOT", confidence: 0.8 }]]),
    lastPlannedByRecipeId: new Map(),
    usedRecipeIds: new Set(),
    targetDate: TARGET_DATE,
  });

  assert.equal(result.candidate.id, "disliked");
  assert.equal(result.confidence, "SLIGHT_DOUBT");
  assert.ok(result.reasons.some((reason) => reason.includes("minder goed bevallen")));
});

test("persoonlijke favorieten wegen mee voor de aanwezige eters", () => {
  const neutral = candidate({ id: "neutral", recipeTitle: "Gewone pasta" });
  const favorite = candidate({ id: "favorite", recipeTitle: "Mila's favoriet" });

  const result = chooseMealPlanCandidate({
    candidates: [neutral, favorite],
    dayKey: "monday",
    busy: false,
    preferredCategories: new Set(),
    variantPreferences: new Map(),
    personalVariantPreferences: new Map([
      ["favorite", [{ personName: "Mila", stance: "LIKED", confidence: 1 }]],
    ]),
    lastPlannedByRecipeId: new Map(),
    usedRecipeIds: new Set(),
    targetDate: TARGET_DATE,
  });

  assert.equal(result.candidate.id, "favorite");
  assert.ok(result.reasons.some((reason) => reason.includes("Mila vindt dit favoriet")));
});

test("persoonlijke sterke afkeur weegt zwaarder dan een lichte huishoudfavoriet", () => {
  const disliked = candidate({ id: "disliked", recipeTitle: "Niet voor Sam" });
  const fallback = candidate({ id: "fallback", recipeTitle: "Rustige keuze" });

  const result = chooseMealPlanCandidate({
    candidates: [disliked, fallback],
    dayKey: "tuesday",
    busy: false,
    preferredCategories: new Set(["PASTA"]),
    variantPreferences: new Map([["disliked", { stance: "LIKED", confidence: 0.5 }]]),
    personalVariantPreferences: new Map([
      ["disliked", [{ personName: "Sam", stance: "RATHER_NOT", confidence: 1 }]],
    ]),
    lastPlannedByRecipeId: new Map(),
    usedRecipeIds: new Set(),
    targetDate: TARGET_DATE,
  });

  assert.equal(result.candidate.id, "fallback");
  assert.equal(result.confidence, "CERTAIN");
});

test("persoonlijke categorievoorkeur weegt mee in de uitleg", () => {
  const veggie = candidate({
    id: "veggie",
    recipeTitle: "Groentecurry",
    recipeCategory: "ALL_VEGGIE_DAY",
  });
  const pasta = candidate({ id: "pasta", recipeTitle: "Pasta" });

  const result = chooseMealPlanCandidate({
    candidates: [pasta, veggie],
    dayKey: "wednesday",
    busy: false,
    preferredCategories: new Set(),
    variantPreferences: new Map(),
    personalCategoryPreferences: new Map([
      ["ALL_VEGGIE_DAY", [{ personName: "Noor", subjectLabel: "vegetarische dagen", stance: "LIKED", confidence: 1 }]],
    ]),
    lastPlannedByRecipeId: new Map(),
    usedRecipeIds: new Set(),
    targetDate: TARGET_DATE,
  });

  assert.equal(result.candidate.id, "veggie");
  assert.ok(result.reasons.some((reason) => reason.includes("Noor houdt van vegetarische dagen")));
});

test("persoonlijke ingrediëntafkeur duwt gerechten met dat ingrediënt omlaag", () => {
  const mushroomPasta = candidate({
    id: "mushroom",
    recipeTitle: "Pasta champignons",
    ingredients: [{ id: "champignons", name: "Champignons" }],
  });
  const tomatoPasta = candidate({
    id: "tomato",
    recipeTitle: "Pasta tomaat",
    ingredients: [{ id: "tomaat", name: "Tomaat" }],
  });

  const result = chooseMealPlanCandidate({
    candidates: [mushroomPasta, tomatoPasta],
    dayKey: "thursday",
    busy: false,
    preferredCategories: new Set(),
    variantPreferences: new Map(),
    personalIngredientPreferences: new Map([
      ["champignons", [{ personName: "Sem", subjectLabel: "Champignons", stance: "RATHER_NOT", confidence: 1 }]],
    ]),
    lastPlannedByRecipeId: new Map(),
    usedRecipeIds: new Set(),
    targetDate: TARGET_DATE,
  });

  assert.equal(result.candidate.id, "tomato");
});

test("bevestigd acceptatiepatroon geeft een zachte categoriebonus op die dag", () => {
  const pasta = candidate({ id: "pasta", recipeTitle: "Dinsdagpasta", recipeCategory: "PASTA" });
  const rice = candidate({ id: "rice", recipeTitle: "Rijstschotel", recipeCategory: "RICE_DISH" });

  const result = chooseMealPlanCandidate({
    candidates: [rice, pasta],
    dayKey: "tuesday",
    busy: false,
    preferredCategories: new Set(),
    variantPreferences: new Map(),
    confirmedCategoryDayPatterns: new Map([["PASTA", { confidence: 0.8 }]]),
    lastPlannedByRecipeId: new Map(),
    usedRecipeIds: new Set(),
    targetDate: TARGET_DATE,
  });

  assert.equal(result.candidate.id, "pasta");
  assert.ok(result.reasons.some((reason) => reason.includes("vaker op dinsdag")));
});

test("daggerichte gerechtvoorkeur geeft concrete gezinsopties voorrang", () => {
  const generalFavorite = candidate({
    id: "general",
    recipeTitle: "Algemene favoriet",
    recipeStatus: "SAFE_CHOICE",
  });
  const mondayOption = candidate({
    id: "monday-option",
    recipeTitle: "Maandag AVG",
    recipeStatus: "FOUND",
    recipeCategory: "ALL_VEGGIE_DAY",
  });

  const result = chooseMealPlanCandidate({
    candidates: [generalFavorite, mondayOption],
    dayKey: "monday",
    busy: false,
    preferredCategories: new Set(),
    variantPreferences: new Map(),
    dayRecipePreferences: new Map([["monday-option", { stance: "LIKED", confidence: 1 }]]),
    lastPlannedByRecipeId: new Map(),
    usedRecipeIds: new Set(),
    targetDate: TARGET_DATE,
  });

  assert.equal(result.candidate.id, "monday-option");
  assert.ok(result.reasons.some((reason) => reason.includes("vaste opties voor maandag")));
});

test("daggerichte gerechtvoorkeur blijft zacht en wint niet van persoonlijke nooit-voorkeur", () => {
  const mondayOption = candidate({ id: "monday-option", recipeTitle: "Maandag pasta" });
  const fallback = candidate({ id: "fallback", recipeTitle: "Veilige rijst", recipeCategory: "RICE_DISH" });

  const result = chooseMealPlanCandidate({
    candidates: [mondayOption, fallback],
    dayKey: "monday",
    busy: false,
    preferredCategories: new Set(),
    variantPreferences: new Map(),
    dayRecipePreferences: new Map([["monday-option", { stance: "LIKED", confidence: 1 }]]),
    personalVariantPreferences: new Map([
      ["monday-option", [{ personName: "Kai", stance: "NEVER", confidence: 1 }]],
    ]),
    lastPlannedByRecipeId: new Map(),
    usedRecipeIds: new Set(),
    targetDate: TARGET_DATE,
  });

  assert.equal(result.candidate.id, "fallback");
});

test("bevestigd acceptatiepatroon blijft zacht en wint niet van persoonlijke nooit-voorkeur", () => {
  const pasta = candidate({ id: "pasta", recipeTitle: "Dinsdagpasta", recipeCategory: "PASTA" });
  const rice = candidate({ id: "rice", recipeTitle: "Rijstschotel", recipeCategory: "RICE_DISH" });

  const result = chooseMealPlanCandidate({
    candidates: [pasta, rice],
    dayKey: "tuesday",
    busy: false,
    preferredCategories: new Set(),
    variantPreferences: new Map(),
    confirmedCategoryDayPatterns: new Map([["PASTA", { confidence: 0.9 }]]),
    personalCategoryPreferences: new Map([
      ["PASTA", [{ personName: "Kai", subjectLabel: "pasta", stance: "NEVER", confidence: 1 }]],
    ]),
    lastPlannedByRecipeId: new Map(),
    usedRecipeIds: new Set(),
    targetDate: TARGET_DATE,
  });

  assert.equal(result.candidate.id, "rice");
});

test("formatteert gebruikersuitleg zonder generieke willekeurtekst", () => {
  const result = chooseMealPlanCandidate({
    candidates: [
      candidate({
        id: "kid-fast",
        recipeTitle: "Snelle kinderpasta",
        variantType: "FAST",
        contextFit: ["kindvriendelijk"],
      }),
    ],
    dayKey: "friday",
    busy: true,
    preferredCategories: new Set(["PASTA"]),
    variantPreferences: new Map(),
    lastPlannedByRecipeId: new Map(),
    usedRecipeIds: new Set(),
    targetDate: TARGET_DATE,
  });

  assert.match(formatMealPlanReason(result), /Snelle kinderpasta is gekozen:/);
  assert.match(formatMealPlanReason(result), /drukke vrijdag/);
  assert.doesNotMatch(formatMealPlanReason(result), /willekeurig|random/i);
});
