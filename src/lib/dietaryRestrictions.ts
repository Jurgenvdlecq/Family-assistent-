/**
 * Vertaalt de vrije tekst die iemand bij onboarding intypt ("pinda's",
 * "lactose-intolerant", "vegetarisch") naar het gecontroleerde vocabulaire
 * van Ingredient.restrictionTags, en bepaalt of een recept daarmee botst.
 *
 * Bewust een klein, gesloten alias-woordenboek in plaats van fuzzy matching:
 * een allergie mag nooit "waarschijnlijk" worden herkend. Tekst die niet in
 * de lijst staat, wordt teruggegeven via `unmatched` — de aanroeper beslist
 * wat daarmee gebeurt (voorlopig: niet uitsluiten, want we weten niet welke
 * ingrediënten te vermijden zijn — maar ook niet doen alsof het is afgedekt).
 */

export const KNOWN_RESTRICTION_TAGS = [
  "gluten",
  "lactose",
  "ei",
  "noten",
  "vis",
  "schaaldieren",
  "varkensvlees",
  "pinda",
] as const;

export type RestrictionTag = (typeof KNOWN_RESTRICTION_TAGS)[number];

const RESTRICTION_ALIASES: Record<string, RestrictionTag> = {
  gluten: "gluten",
  glutenvrij: "gluten",
  glutenintolerantie: "gluten",
  glutenallergie: "gluten",
  coeliakie: "gluten",
  tarwe: "gluten",
  lactose: "lactose",
  lactoseintolerant: "lactose",
  lactoseintolerantie: "lactose",
  zuivel: "lactose",
  zuivelvrij: "lactose",
  ei: "ei",
  eieren: "ei",
  eiallergie: "ei",
  noot: "noten",
  noten: "noten",
  notenallergie: "noten",
  pijnboompitten: "noten",
  vis: "vis",
  visallergie: "vis",
  schaaldieren: "schaaldieren",
  schelpdieren: "schaaldieren",
  garnalen: "schaaldieren",
  varken: "varkensvlees",
  varkensvlees: "varkensvlees",
  geenvarkensvlees: "varkensvlees",
  pinda: "pinda",
  pindas: "pinda",
  pindaallergie: "pinda",
  apennoot: "pinda",
  apennootjes: "pinda",
};

const VEGETARIAN_KEYWORDS = new Set(["vegetarisch", "vegetarier", "geenvlees", "vlees"]);
const VEGAN_KEYWORDS = new Set(["veganistisch", "vegan", "plantaardig"]);

export function normalizeRestriction(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export interface ResolvedRestrictions {
  // Set<string> (niet Set<RestrictionTag>) zodat dit rechtstreeks vergeleken
  // kan worden met Ingredient.restrictionTags, dat als vrije string[] uit de
  // database komt.
  tags: Set<string>;
  vegetarian: boolean;
  vegan: boolean;
  /** Restrictie-tekst die niet aan een bekende tag of modus gekoppeld kon worden. */
  unmatched: string[];
}

export function resolveRestrictions(rawRestrictions: string[]): ResolvedRestrictions {
  const tags = new Set<string>();
  const unmatched: string[] = [];
  let vegetarian = false;
  let vegan = false;

  for (const raw of rawRestrictions) {
    const normalized = normalizeRestriction(raw);
    if (!normalized) continue;

    if (VEGAN_KEYWORDS.has(normalized)) {
      vegan = true;
      continue;
    }
    if (VEGETARIAN_KEYWORDS.has(normalized)) {
      vegetarian = true;
      continue;
    }
    const tag = RESTRICTION_ALIASES[normalized];
    if (tag) {
      tags.add(tag);
    } else {
      unmatched.push(raw);
    }
  }

  return { tags, vegetarian, vegan, unmatched };
}

export interface RestrictionCheckIngredient {
  category: string;
  restrictionTags: string[];
}

const VEGETARIAN_EXCLUDED_CATEGORIES = new Set(["MEAT", "FISH"]);
const VEGAN_EXCLUDED_CATEGORIES = new Set(["MEAT", "FISH", "DAIRY"]);

/**
 * True zodra minstens één ingrediënt van het recept botst met de
 * gecombineerde harde beperkingen. `rawRestrictions` is de al-samengevoegde
 * lijst van alle aanwezige gezinsleden (Fase 10: een allergie van één
 * gezinslid sluit het gerecht voor het hele huishouden uit, ongeacht wie er
 * nog meer meeeet).
 */
export function recipeConflictsWithRestrictions(
  ingredients: RestrictionCheckIngredient[],
  rawRestrictions: string[]
): boolean {
  const { tags, vegetarian, vegan } = resolveRestrictions(rawRestrictions);
  if (tags.size === 0 && !vegetarian && !vegan) return false;

  return ingredients.some((ingredient) => {
    if (vegan && VEGAN_EXCLUDED_CATEGORIES.has(ingredient.category)) return true;
    if (vegetarian && VEGETARIAN_EXCLUDED_CATEGORIES.has(ingredient.category)) return true;
    return ingredient.restrictionTags.some((tag) => tags.has(tag));
  });
}
