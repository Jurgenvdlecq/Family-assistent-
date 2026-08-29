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

// ── Dagprofielen ────────────────────────────────────────────────────────────

import { DAY_PROFILES } from "./dayProfiles";

/** Alles wat een scoringsaanroep minimaal nodig heeft, zonder profiel. */
function baseInput(candidates: MealPlanCandidate[]) {
  return {
    candidates,
    dayKey: "monday" as const,
    busy: false,
    preferredCategories: new Set<string>(),
    variantPreferences: new Map(),
    lastPlannedByRecipeId: new Map<string, Date>(),
    usedRecipeIds: new Set<string>(),
    targetDate: TARGET_DATE,
  };
}

test("dagprofiel: een drukke, vroege avond kiest het opwarmbare gerecht", () => {
  const elaborate = candidate({
    id: "elaborate",
    recipeTitle: "Hachee met aardappelpuree",
    recipeCategory: "COMFORT_FOOD",
    recipeProperties: ["comfortfood"],
    variantType: "FRESH",
  });
  const reheatable = candidate({
    id: "reheatable",
    recipeTitle: "Pasta pesto met kip",
    recipeCategory: "PASTA",
    recipeProperties: ["opwarmbaar", "snel"],
    variantType: "REHEATABLE",
  });

  const result = chooseMealPlanCandidate({
    ...baseInput([elaborate, reheatable]),
    dayProfile: DAY_PROFILES.BUSY_EARLY_REHEATABLE,
  });

  assert.equal(result.candidate.id, "reheatable");
  assert.ok(
    result.reasons.some((reason) => reason.includes("past bij jullie maandag")),
    `de uitleg moet het dagprofiel noemen, kreeg: ${result.reasons.join(" | ")}`
  );
});

test("dagprofiel: rijst met kip kiest het rijstgerecht mét kip", () => {
  const riceOnly = candidate({
    id: "rice-only",
    recipeTitle: "Nasi met ei en groenten",
    recipeCategory: "RICE_DISH",
    ingredients: [{ id: "rijst", name: "Rijst" }],
  });
  const riceAndChicken = candidate({
    id: "rice-chicken",
    recipeTitle: "Kip teriyaki met rijst",
    recipeCategory: "RICE_DISH",
    ingredients: [
      { id: "rijst", name: "Rijst" },
      { id: "kip", name: "Kipfilet" },
    ],
  });

  const result = chooseMealPlanCandidate({
    ...baseInput([riceOnly, riceAndChicken]),
    dayProfile: DAY_PROFILES.ADULT_RICE_CHICKEN,
  });

  assert.equal(result.candidate.id, "rice-chicken");
});

test("dagprofiel: een gerecht dat nergens op scoort wordt niet uitgesloten, alleen lager gezet", () => {
  // Belangrijk onderscheid: een profiel is een voorkeur, geen beperking.
  // Als er niets anders is, moet het gerecht gewoon gekozen worden.
  const mismatch = candidate({
    id: "mismatch",
    recipeTitle: "Hachee met aardappelpuree",
    recipeCategory: "COMFORT_FOOD",
    variantType: "FRESH",
  });

  const result = chooseMealPlanCandidate({
    ...baseInput([mismatch]),
    dayProfile: DAY_PROFILES.ADULT_RICE_CHICKEN,
  });

  assert.equal(result.candidate.id, "mismatch");
  assert.equal(result.confidence, "SLIGHT_DOUBT", "de app moet er wel bij zeggen dat ze twijfelt");
});

test("dagprofiel: zonder profiel verandert er niets aan de bestaande scoring", () => {
  // De backwards-compatibiliteitstest: een huishouden zonder weekritme moet
  // exact dezelfde keuze en dezelfde score krijgen als vóór deze wijziging.
  const candidates = [
    candidate({ id: "a", recipeTitle: "Pasta pesto met kip", variantType: "FAST" }),
    candidate({ id: "b", recipeTitle: "Lasagne", recipeCategory: "COMFORT_FOOD", variantType: "FRESH" }),
  ];

  const withoutProfile = chooseMealPlanCandidate(baseInput(candidates));
  const withExplicitNull = chooseMealPlanCandidate({ ...baseInput(candidates), dayProfile: null });

  assert.equal(withoutProfile.candidate.id, withExplicitNull.candidate.id);
  assert.equal(withoutProfile.score, withExplicitNull.score);
  assert.deepEqual(withoutProfile.reasons, withExplicitNull.reasons);
});

test("dagprofiel: een te vermijden eigenschap kost punten maar sluit niet uit", () => {
  const extensive = candidate({
    id: "extensive",
    recipeTitle: "Lasagne",
    recipeCategory: "COMFORT_FOOD",
    recipeProperties: ["uitgebreid"],
    contextFit: ["uitgebreid"],
    variantType: "FRESH",
  });
  const simple = candidate({
    id: "simple",
    recipeTitle: "Omelet met groenten en kaas",
    recipeCategory: "QUICK_AND_EASY",
    variantType: "FAST",
  });

  const result = chooseMealPlanCandidate({
    ...baseInput([extensive, simple]),
    dayProfile: DAY_PROFILES.FAMILY_EASY,
  });
  assert.equal(result.candidate.id, "simple");

  const onlyExtensive = chooseMealPlanCandidate({
    ...baseInput([extensive]),
    dayProfile: DAY_PROFILES.FAMILY_EASY,
  });
  assert.equal(onlyExtensive.candidate.id, "extensive", "één kandidaat blijft altijd kiesbaar");
});

test("zelf halen: een gerecht met een extern ingrediënt scoort lager maar blijft kiesbaar", () => {
  // De eis uit de opdracht: markeren mag het gerecht niet onbruikbaar maken.
  const withExternal = candidate({
    id: "biefstuk",
    recipeTitle: "Biefstuk met paprika",
    ingredients: [
      { id: "biefstuk", name: "Biefstuk" },
      { id: "paprika", name: "Paprika" },
    ],
  });
  const withoutExternal = candidate({
    id: "kip",
    recipeTitle: "Kip met paprika",
    ingredients: [
      { id: "kip", name: "Kipfilet" },
      { id: "paprika", name: "Paprika" },
    ],
  });
  const externalIngredientIds = new Set(["biefstuk"]);

  const both = chooseMealPlanCandidate({
    ...baseInput([withExternal, withoutExternal]),
    externalIngredientIds,
  });
  assert.equal(both.candidate.id, "kip", "bij gelijke geschiktheid wint het gerecht zonder extra boodschap");

  const onlyExternal = chooseMealPlanCandidate({
    ...baseInput([withExternal]),
    externalIngredientIds,
  });
  assert.equal(onlyExternal.candidate.id, "biefstuk", "maar als het de enige optie is, wordt hij gewoon gekozen");
  assert.ok(
    onlyExternal.reasons.some((reason) => reason.includes("zelf nog halen")),
    `de uitleg hoort te waarschuwen, kreeg: ${onlyExternal.reasons.join(" | ")}`
  );
});

test("zelf halen: een profiel dat alles via Picnic wil, weegt een externe boodschap zwaarder", () => {
  const withExternal = candidate({
    id: "biefstuk",
    recipeTitle: "Biefstuk met paprika",
    ingredients: [{ id: "biefstuk", name: "Biefstuk" }],
  });
  const externalIngredientIds = new Set(["biefstuk"]);

  const neutral = chooseMealPlanCandidate({ ...baseInput([withExternal]), externalIngredientIds });
  const picnicFirst = chooseMealPlanCandidate({
    ...baseInput([withExternal]),
    externalIngredientIds,
    dayProfile: DAY_PROFILES.ADULT_TAKEAWAY_REPLACEMENT,
  });

  assert.ok(
    picnicFirst.score < neutral.score,
    "op een avond die bestellen moet vervangen telt 'nog even langs de slager' zwaarder"
  );
});

test("aanbieding: geeft de doorslag tussen twee gerechten die verder gelijk scoren", () => {
  // Dit is waar de aanbieding voor bedoeld is: een dubbeltje op zijn kant.
  const metKip = candidate({
    id: "a-kip",
    recipeTitle: "Kip met rijst",
    ingredients: [{ id: "kip", name: "Kipfilet" }],
  });
  const zonderKip = candidate({
    id: "b-vis",
    recipeTitle: "Vis met rijst",
    ingredients: [{ id: "vis", name: "Kabeljauw" }],
  });

  const result = chooseMealPlanCandidate({
    candidates: [metKip, zonderKip],
    dayKey: "wednesday",
    busy: false,
    preferredCategories: new Set(),
    variantPreferences: new Map(),
    ingredientsOnOffer: new Map([["kip", { label: "Kipfilet", storeLabel: "Albert Heijn" }]]),
    lastPlannedByRecipeId: new Map(),
    usedRecipeIds: new Set(),
    targetDate: TARGET_DATE,
  });

  assert.equal(result.candidate.id, "a-kip");
  assert.ok(
    result.reasons.some((reason) => reason.includes("in de bonus bij Albert Heijn")),
    "de reden hoort zichtbaar te zijn"
  );
});

test("aanbieding: wint nooit van wat iemand liever niet eet", () => {
  // Het plafond bestaat hiervoor. Anders eten we alleen nog wat er in de
  // actie ligt.
  const inDeBonus = candidate({
    id: "a-bonus",
    recipeTitle: "Kip met rijst",
    ingredients: [
      { id: "kip", name: "Kipfilet" },
      { id: "rijst", name: "Rijst" },
      { id: "ui", name: "Ui" },
    ],
  });
  const gewoon = candidate({ id: "b-gewoon", recipeTitle: "Pasta pesto" });

  const result = chooseMealPlanCandidate({
    candidates: [inDeBonus, gewoon],
    dayKey: "wednesday",
    busy: false,
    preferredCategories: new Set(),
    variantPreferences: new Map(),
    personalVariantPreferences: new Map([
      ["a-bonus", [{ personName: "Lynn", stance: "RATHER_NOT", confidence: 1 }]],
    ]),
    ingredientsOnOffer: new Map([
      ["kip", { label: "Kipfilet", storeLabel: "Albert Heijn" }],
      ["rijst", { label: "Rijst", storeLabel: "Albert Heijn" }],
      ["ui", { label: "Ui", storeLabel: "Albert Heijn" }],
    ]),
    lastPlannedByRecipeId: new Map(),
    usedRecipeIds: new Set(),
    targetDate: TARGET_DATE,
  });

  assert.equal(result.candidate.id, "b-gewoon", "een afkeur weegt zwaarder dan drie aanbiedingen");
});

test("aanbieding: zonder aanbiedingen verandert er niets aan de score", () => {
  // Achterwaartse compatibiliteit: een huishouden zonder prijsgegevens moet
  // exact dezelfde keuzes krijgen als voorheen.
  const base = {
    candidates: [candidate({ id: "a" }), candidate({ id: "b" })],
    dayKey: "monday" as const,
    busy: false,
    preferredCategories: new Set<string>(),
    variantPreferences: new Map(),
    lastPlannedByRecipeId: new Map(),
    usedRecipeIds: new Set<string>(),
    targetDate: TARGET_DATE,
  };
  const zonder = chooseMealPlanCandidate(base);
  const metLege = chooseMealPlanCandidate({ ...base, ingredientsOnOffer: new Map() });
  assert.equal(zonder.candidate.id, metLege.candidate.id);
  assert.equal(zonder.score, metLege.score);
});
