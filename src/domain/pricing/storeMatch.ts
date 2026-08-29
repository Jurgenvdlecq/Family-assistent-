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

/**
 * Woorden die niets zeggen over wélk product het is.
 *
 * De winkelnamen staan hier niet toevallig bij. Onze eigen ingrediëntnamen
 * komen uit Picnic-producten en heten daardoor soms letterlijk "Picnic
 * Appelmoes". Zonder "picnic" als ruiswoord haalt dat ingrediënt bij Albert
 * Heijn nooit de drempel — "AH Appelmoes" dekt dan maar één van de twee
 * woorden — en meldt het scherm "niet gevonden" terwijl het product er gewoon
 * ligt. In productie was dat op de meeste regels het geval.
 */
const NOISE_WORDS = new Set([
  "ah",
  "albert",
  "heijn",
  "dirk",
  "picnic",
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
 * Waarmee we bij een winkel zoeken.
 *
 * Niet de ingrediëntnaam zelf: die kan de naam van een andere winkel bevatten
 * ("Picnic Appelmoes"), en daar zoekt Albert Heijn niets nuttigs op. Blijft er
 * niets over, dan valt het terug op de oorspronkelijke naam — liever een
 * matige zoekopdracht dan een lege.
 */
export function storeSearchTerm(ingredientName: string): string {
  const words = contentWords(ingredientName);
  return words.length > 0 ? words.join(" ") : ingredientName;
}

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
  // Ook zonder spaties vergelijken. Winkels schrijven samenstellingen
  // verschillend: "Allesreinigerdoekjes" bij ons, "Allesreiniger doekjes" bij
  // Albert Heijn. Dat is hetzelfde product, maar op letterniveau vond de ene
  // vorm de andere niet — en dan meldde het scherm "niet gevonden" terwijl het
  // product er ligt. Dit voegt geen enkele nieuwe overeenkomst toe die niet
  // letterlijk uit dezelfde letters bestaat.
  const joined = haystack.replace(/ /g, "");
  const hits = wanted.filter((word) => haystack.includes(word) || joined.includes(word)).length;
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
