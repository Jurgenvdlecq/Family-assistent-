export const MEAL_TAGS = [
  "AVG",
  "FAST",
  "LOW_EFFORT",
  "NORMAL_EFFORT",
  "EXTENSIVE",
  "KID_FRIENDLY",
  "AIRFRYER",
  "PASTA",
  "RICE",
  "WRAPS",
  "WEEKEND",
  "LEFTOVER_FRIENDLY",
  "VEGETARIAN",
  "COMFORT",
  "HEALTHY",
  // Toegevoegd voor de dagprofielen (zie domain/meal-planning/dayProfiles.ts):
  // een profiel als "rijst met kip" of "in plaats van bestellen" moet iets
  // preciezers kunnen zeggen dan alleen "snel" of "makkelijk".
  "CHICKEN",
  "POTATO",
  "WORLD_FOOD",
] as const;

export type MealTag = (typeof MEAL_TAGS)[number];

export interface MealTagCandidate {
  recipeCategory: string;
  /** Optioneel: alleen gebruikt om een wereldgerecht te herkennen. */
  recipeTitle?: string;
  recipeProperties: string[];
  variantType: string;
  contextFit: string[];
  ingredients: { id: string; name: string }[];
}

export interface MealWish {
  raw: string;
  tags: MealTag[];
  ingredientIds: string[];
  unknownTerms: string[];
}

export interface MealWishScore {
  score: number;
  reasons: string[];
  missing: string[];
}

const TAG_ALIASES: Record<MealTag, string[]> = {
  AVG: ["avg", "aardappel groente vlees", "aardappelen groente vlees", "aardappel groente"],
  FAST: ["snel", "snelle", "makkelijk", "vlug", "weinig tijd", "druk"],
  LOW_EFFORT: ["makkelijk", "simpel", "weinig werk", "weinig moeite"],
  NORMAL_EFFORT: ["normaal", "gewone maaltijd", "doordeweeks"],
  EXTENSIVE: ["uitgebreid", "weekend koken", "veel tijd"],
  KID_FRIENDLY: ["kindvriendelijk", "kinderen", "kids"],
  AIRFRYER: ["airfryer", "air fryer"],
  PASTA: ["pasta", "spaghetti", "macaroni", "lasagne"],
  RICE: ["rijst", "rijstgerecht", "nasi"],
  WRAPS: ["wrap", "wraps", "tortilla", "tortillas"],
  WEEKEND: ["weekend", "zaterdag", "zondag"],
  LEFTOVER_FRIENDLY: ["opwarmbaar", "restjes", "voor morgen", "mealprep"],
  VEGETARIAN: ["vegetarisch", "vega", "zonder vlees"],
  COMFORT: ["comfort", "comfortfood", "stamppot", "gezellig"],
  HEALTHY: ["gezond", "licht", "fris"],
  // Bewust leeg: deze drie tags bestaan voor de dagprofielen, die alleen naar
  // de eigenschappen van een gerecht kijken. Ze óók als zoekterm toevoegen zou
  // de vrije maaltijdwens veranderen zonder dat daar iets aan mankeert —
  // "kip" komt daar al binnen als ingrediënt (INGREDIENT_ALIAS_GROUPS), en
  // een gerecht zou dan twee keer punten krijgen voor hetzelfde woord.
  CHICKEN: [],
  POTATO: [],
  WORLD_FOOD: [],
};

const PROPERTY_TAGS: Record<string, MealTag[]> = {
  // "uitgebreid" stond wel in de zoektermen (TAG_ALIASES) maar werd nergens
  // uit een gerecht afgeleid: wie "uitgebreid" typte kreeg daardoor nooit een
  // treffer. Nu symmetrisch, net als alle andere eigenschappen.
  uitgebreid: ["EXTENSIVE"],
  weekend_koken: ["EXTENSIVE", "WEEKEND"],
  snel: ["FAST", "LOW_EFFORT"],
  drukke_dag: ["FAST", "LOW_EFFORT"],
  makkelijk: ["LOW_EFFORT"],
  kindvriendelijk: ["KID_FRIENDLY"],
  airfryer: ["AIRFRYER"],
  weekend: ["WEEKEND"],
  opwarmbaar: ["LEFTOVER_FRIENDLY"],
  vegetarisch: ["VEGETARIAN"],
  comfortfood: ["COMFORT"],
  gezellig_samen: ["COMFORT"],
  gezond: ["HEALTHY"],
  licht: ["HEALTHY"],
};

const CATEGORY_TAGS: Record<string, MealTag[]> = {
  PASTA: ["PASTA"],
  WRAPS: ["WRAPS", "WORLD_FOOD"],
  RICE_DISH: ["RICE"],
  ALL_VEGGIE_DAY: ["AVG"],
  QUICK_AND_EASY: ["FAST", "LOW_EFFORT"],
  COMFORT_FOOD: ["COMFORT"],
  AIRFRYER: ["AIRFRYER", "FAST"],
};

const VARIANT_TAGS: Record<string, MealTag[]> = {
  FAST: ["FAST", "LOW_EFFORT"],
  REHEATABLE: ["LEFTOVER_FRIENDLY", "LOW_EFFORT"],
  KID_FRIENDLY: ["KID_FRIENDLY"],
  FRESH: ["NORMAL_EFFORT"],
};

const INGREDIENT_ALIAS_GROUPS = [
  {
    triggers: ["kip"],
    ingredientAliases: ["kipfilet", "kip"],
  },
  {
    triggers: ["aardappel", "aardappelen", "aardappeltjes"],
    ingredientAliases: ["aardappel", "aardappelen", "aardappelpartjes"],
  },
  {
    triggers: ["rijst"],
    ingredientAliases: ["rijst"],
  },
  {
    triggers: ["pasta", "spaghetti", "macaroni"],
    ingredientAliases: ["pasta", "spaghetti", "macaroni"],
  },
  {
    triggers: ["boon", "bonen", "boontjes", "sperziebonen"],
    ingredientAliases: ["sperziebonen", "boon", "bonen"],
  },
  {
    triggers: ["paprika"],
    ingredientAliases: ["paprika"],
  },
];

export function normalizeMealText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function addTags(target: Set<MealTag>, tags: MealTag[] | undefined) {
  for (const tag of tags ?? []) target.add(tag);
}

function containsNormalizedPhrase(text: string, phrase: string) {
  return ` ${text} `.includes(` ${phrase} `);
}

function scoreIngredientForAlias(ingredientName: string, ingredientAliases: string[]) {
  return ingredientAliases.reduce((best, alias, index) => {
    const normalizedAlias = normalizeMealText(alias);
    if (!normalizedAlias) return best;
    if (ingredientName === normalizedAlias) return Math.max(best, 90 - index);
    if (containsNormalizedPhrase(ingredientName, normalizedAlias)) return Math.max(best, 70 - index);
    if (ingredientName.includes(normalizedAlias)) return Math.max(best, 45 - index);
    return best;
  }, 0);
}

function rankIngredientMatch(name: string, normalized: string) {
  const ingredientName = normalizeMealText(name);
  const mainName = ingredientName.split(" ")[0];
  if (ingredientName && containsNormalizedPhrase(normalized, ingredientName)) return 120 + ingredientName.length;
  if (mainName.length >= 3 && containsNormalizedPhrase(normalized, mainName)) return 95 + mainName.length;
  return 0;
}

function pickBestIngredientIdForAlias(
  ingredients: { id: string; name: string }[],
  ingredientAliases: string[],
  usedIngredientIds: Set<string>
) {
  return ingredients
    .filter((ingredient) => !usedIngredientIds.has(ingredient.id))
    .map((ingredient) => ({
      ingredient,
      score: scoreIngredientForAlias(normalizeMealText(ingredient.name), ingredientAliases),
    }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.ingredient.name.length - b.ingredient.name.length || a.ingredient.name.localeCompare(b.ingredient.name))[0]
    ?.ingredient.id;
}

function hasStarchyIngredient(candidate: MealTagCandidate) {
  return candidate.ingredients.some((ingredient) => {
    const name = normalizeMealText(ingredient.name);
    return name.includes("aardappel") || name.includes("rijst") || name.includes("pasta");
  });
}

function hasVegetable(candidate: MealTagCandidate) {
  return candidate.ingredients.some((ingredient) => {
    const name = normalizeMealText(ingredient.name);
    return [
      "boon",
      "bonen",
      "broccoli",
      "bloemkool",
      "courgette",
      "paprika",
      "sla",
      "spinazie",
      "tomaat",
      "wortel",
      "groente",
    ].some((part) => name.includes(part));
  });
}

function hasProtein(candidate: MealTagCandidate) {
  return candidate.ingredients.some((ingredient) => {
    const name = normalizeMealText(ingredient.name);
    return [
      "kip",
      "gehakt",
      "rund",
      "schnitzel",
      "zalm",
      "vis",
      "worst",
      "ei",
      "bonen",
      "linzen",
      "kikkererwten",
    ].some((part) => name.includes(part));
  });
}

function hasIngredientLike(candidate: MealTagCandidate, parts: string[]) {
  return candidate.ingredients.some((ingredient) => {
    const name = normalizeMealText(ingredient.name);
    return parts.some((part) => name.includes(part));
  });
}

const WORLD_FOOD_TITLE_HINTS = [
  "curry",
  "burrito",
  "taco",
  "teriyaki",
  "wok",
  "nasi",
  "shakshuka",
  "couscous",
  "chili",
  "fajita",
  "shoarma",
  "kerrie",
];

export function tagsForMealCandidate(candidate: MealTagCandidate): MealTag[] {
  const tags = new Set<MealTag>();
  addTags(tags, CATEGORY_TAGS[candidate.recipeCategory]);
  addTags(tags, VARIANT_TAGS[candidate.variantType]);

  for (const value of [...candidate.recipeProperties, ...candidate.contextFit]) {
    addTags(tags, PROPERTY_TAGS[normalizeMealText(value).replaceAll(" ", "_")]);
  }

  if (hasStarchyIngredient(candidate) && hasVegetable(candidate) && hasProtein(candidate)) {
    tags.add("AVG");
  }

  // Ingrediënt-gestuurde tags: een dagprofiel als "rijst met kip" moet kunnen
  // herkennen wat er in het gerecht zit, niet alleen in welke categorie het valt.
  if (hasIngredientLike(candidate, ["kip"])) tags.add("CHICKEN");
  if (hasIngredientLike(candidate, ["aardappel"])) tags.add("POTATO");
  if (hasIngredientLike(candidate, ["rijst"])) tags.add("RICE");
  if (hasIngredientLike(candidate, ["pasta", "spaghetti", "macaroni", "lasagne"])) tags.add("PASTA");

  // "Wereldgerecht" staat nergens als eigenschap geregistreerd, maar zit wel
  // herkenbaar in de titel van dit soort gerechten. Bewust een lijst met
  // duidelijke termen en geen slimmigheid: liever een tag missen dan er een
  // verzinnen.
  const title = normalizeMealText(candidate.recipeTitle ?? "");
  if (title && WORLD_FOOD_TITLE_HINTS.some((hint) => title.includes(hint))) {
    tags.add("WORLD_FOOD");
  }

  return [...tags].sort();
}

export function parseMealWish(raw: string, ingredients: { id: string; name: string }[]): MealWish {
  const normalized = normalizeMealText(raw);
  if (!normalized) return { raw, tags: [], ingredientIds: [], unknownTerms: [] };

  const tags = new Set<MealTag>();
  for (const tag of MEAL_TAGS) {
    if (TAG_ALIASES[tag].some((alias) => normalized.includes(normalizeMealText(alias)))) {
      tags.add(tag);
    }
  }

  const ingredientIds = new Set<string>();
  const matchedIngredientTerms = new Set<string>();
  const usedIngredientIds = new Set<string>();
  const directIngredientMatches = ingredients
    .map((ingredient) => ({ ingredient, score: rankIngredientMatch(ingredient.name, normalized) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.ingredient.name.localeCompare(b.ingredient.name));

  for (const match of directIngredientMatches) {
    if (usedIngredientIds.has(match.ingredient.id)) continue;
    ingredientIds.add(match.ingredient.id);
    usedIngredientIds.add(match.ingredient.id);
    matchedIngredientTerms.add(normalizeMealText(match.ingredient.name).split(" ")[0]);
  }

  for (const group of INGREDIENT_ALIAS_GROUPS) {
    const matchedTrigger = group.triggers.find((trigger) => {
      const normalizedTrigger = normalizeMealText(trigger);
      return containsNormalizedPhrase(normalized, normalizedTrigger);
    });
    if (!matchedTrigger) continue;
    const ingredientId = pickBestIngredientIdForAlias(ingredients, group.ingredientAliases, usedIngredientIds);
    if (!ingredientId) continue;
    ingredientIds.add(ingredientId);
    usedIngredientIds.add(ingredientId);
    for (const trigger of group.triggers) matchedIngredientTerms.add(normalizeMealText(trigger));
  }

  const knownWords = new Set([
    "we",
    "hebben",
    "trek",
    "in",
    "met",
    "en",
    "voor",
    "zin",
    ...MEAL_TAGS.flatMap((tag) => TAG_ALIASES[tag].flatMap((alias) => normalizeMealText(alias).split(" "))),
    ...INGREDIENT_ALIAS_GROUPS.flatMap((group) => group.triggers.flatMap((trigger) => normalizeMealText(trigger).split(" "))),
    ...matchedIngredientTerms,
  ]);
  const unknownTerms = normalized
    .split(" ")
    .filter((word) => word.length >= 4 && !knownWords.has(word))
    .slice(0, 4);

  return { raw, tags: [...tags].sort(), ingredientIds: [...ingredientIds].sort(), unknownTerms };
}

export function scoreMealWish(candidate: MealTagCandidate, wish: MealWish): MealWishScore {
  const candidateTags = new Set(tagsForMealCandidate(candidate));
  const candidateIngredientIds = new Set(candidate.ingredients.map((ingredient) => ingredient.id));
  const reasons: string[] = [];
  const missing: string[] = [];
  let score = 0;

  for (const tag of wish.tags) {
    if (candidateTags.has(tag)) {
      score += tag === "AVG" ? 24 : 14;
      reasons.push(tag.toLowerCase().replaceAll("_", " "));
    } else {
      missing.push(tag.toLowerCase().replaceAll("_", " "));
    }
  }

  for (const ingredientId of wish.ingredientIds) {
    if (candidateIngredientIds.has(ingredientId)) {
      score += 22;
      const ingredient = candidate.ingredients.find((item) => item.id === ingredientId);
      if (ingredient) reasons.push(ingredient.name.toLowerCase());
    } else {
      missing.push("ingrediënt");
    }
  }

  return { score, reasons, missing };
}
