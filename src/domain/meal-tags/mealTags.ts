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
] as const;

export type MealTag = (typeof MEAL_TAGS)[number];

export interface MealTagCandidate {
  recipeCategory: string;
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
};

const PROPERTY_TAGS: Record<string, MealTag[]> = {
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
  WRAPS: ["WRAPS"],
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

const INGREDIENT_ALIASES: Record<string, string[]> = {
  kip: ["kip", "kipfilet", "kipdijfilet", "kipshoarma", "kipdrumsticks", "pulled chicken"],
  aardappel: ["aardappel", "aardappelen", "aardappelpartjes"],
  rijst: ["rijst"],
  pasta: ["pasta", "spaghetti", "macaroni"],
  bonen: ["boon", "bonen", "sperziebonen", "kidneybonen", "zwarte bonen"],
};

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
  for (const ingredient of ingredients) {
    const ingredientName = normalizeMealText(ingredient.name);
    const mainName = ingredientName.split(" ")[0];
    const aliasMatches = Object.entries(INGREDIENT_ALIASES).some(
      ([wishAlias, ingredientAliases]) =>
        normalized.includes(wishAlias) && ingredientAliases.some((alias) => ingredientName.includes(normalizeMealText(alias)))
    );
    if (
      ingredientName &&
      (normalized.includes(ingredientName) ||
        (mainName.length >= 3 && normalized.includes(mainName)) ||
        aliasMatches)
    ) {
      ingredientIds.add(ingredient.id);
      matchedIngredientTerms.add(mainName);
      for (const alias of Object.keys(INGREDIENT_ALIASES)) matchedIngredientTerms.add(alias);
    }
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
