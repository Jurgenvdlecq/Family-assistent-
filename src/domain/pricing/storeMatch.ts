import type { ProviderProduct } from "./types";

/**
 * Welk winkelproduct hoort bij welk ingrediënt?
 *
 * Dit is expres een voorzichtige, uitlegbare score en geen slimme
 * tekstvergelijking. De reden staat in de opdracht: een matcher die er
 * makkelijk iets bij zoekt, liegt. Liever een ingrediënt zonder match — dat
 * wordt zichtbaar getoond als "niet gevonden" — dan een match die er goed
 * uitziet en het verkeerde product is.
 *
 * De score zegt alleen iets over *of dit hetzelfde product is*. Of het ook
 * een gelijkwaardige keuze is (bio, vers, merk) is een aparte vraag, en die
 * hoort in `equivalence.ts`.
 */

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Woorden die niets zeggen over wélk product het is. */
const NOISE_WORDS = new Set([
  "ah",
  "albert",
  "heijn",
  "dirk",
  "de",
  "het",
  "een",
  "van",
  "met",
  "per",
  "stuk",
  "stuks",
  "gram",
  "kilo",
  "liter",
  "verpakking",
]);

function contentWords(value: string): string[] {
  return normalize(value)
    .split(" ")
    .filter((word) => word.length > 2 && !NOISE_WORDS.has(word));
}

export const STORE_MATCH_THRESHOLD = 0.6;

/**
 * Hoe goed dekt dit winkelproduct de naam van het ingrediënt?
 *
 * 1 betekent: alle betekenisdragende woorden van het ingrediënt komen terug in
 * de productnaam. Onder de drempel geldt het als niet gevonden.
 */
export function scoreStoreProductForIngredient(ingredientName: string, productName: string): number {
  const wanted = contentWords(ingredientName);
  if (wanted.length === 0) return 0;

  const haystack = normalize(productName);
  const hits = wanted.filter((word) => haystack.includes(word)).length;
  return hits / wanted.length;
}

export interface StoreMatchResult {
  product: ProviderProduct;
  score: number;
  /**
   * Hoeveel betekenisdragende woorden de productnaam méér heeft dan het
   * ingrediënt. "AH Biologische halfvolle melk" dekt "halfvolle melk" volledig,
   * maar is een specifieker product dan "AH Halfvolle melk" — en dat verschil
   * moet in de volgorde terugkomen, anders dringt een bioproduct voor bij het
   * gewone.
   */
  surplusWords: number;
}

/**
 * De beste kandidaten voor dit ingrediënt, gesorteerd van meest naar minst
 * passend. Alles onder de drempel valt af.
 *
 * Er worden er meerdere teruggegeven en niet één: het equivalentiemodel moet
 * straks kunnen kiezen tussen "hetzelfde soort product" en "een goedkoper
 * alternatief uit een andere klasse", en dat kan alleen als beide bewaard zijn.
 */
export function rankStoreProducts(
  ingredientName: string,
  products: ProviderProduct[],
  limit = 5
): StoreMatchResult[] {
  const wanted = new Set(contentWords(ingredientName));

  return products
    .map((product) => ({
      product,
      score: scoreStoreProductForIngredient(ingredientName, product.name),
      surplusWords: contentWords(product.name).filter((word) => !wanted.has(word)).length,
    }))
    .filter((match) => match.score >= STORE_MATCH_THRESHOLD)
    .sort(
      (a, b) =>
        b.score - a.score ||
        // Het minst specifieke product voorop: dat is de gewone variant.
        a.surplusWords - b.surplusWords ||
        // Daarna de kleinste verpakking — meestal het normale formaat, niet
        // de familieverpakking.
        (a.product.content?.amount ?? Number.MAX_SAFE_INTEGER) -
          (b.product.content?.amount ?? Number.MAX_SAFE_INTEGER) ||
        a.product.externalRef.localeCompare(b.product.externalRef)
    )
    .slice(0, limit);
}
