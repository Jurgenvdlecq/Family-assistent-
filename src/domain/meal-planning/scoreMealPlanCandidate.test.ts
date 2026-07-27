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
