import { Unit, type IngredientCategory } from "@/generated/prisma/enums";
import { parsePackageQuantity } from "@/lib/quantity/parsePackageSize";

export function titleCaseSearchTerm(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function inferFixedGroceryQuantity(packageSize: string | null | undefined) {
  const gram = parsePackageQuantity(packageSize ?? null, Unit.GRAM);
  if (gram != null) return { quantity: gram, unit: Unit.GRAM };

  const ml = parsePackageQuantity(packageSize ?? null, Unit.ML);
  if (ml != null) return { quantity: ml, unit: Unit.ML };

  const pieces = parsePackageQuantity(packageSize ?? null, Unit.PIECE);
  if (pieces != null) return { quantity: pieces, unit: Unit.PIECE };

  return { quantity: 1, unit: Unit.PIECE };
}

export function inferFixedProductOrderQuantity(multiplier = 1) {
  return {
    quantity: multiplier,
    unit: Unit.PIECE,
  };
}

export interface ParsedBulkFixedGroceryLine {
  raw: string;
  searchTerm: string;
  multiplier: number;
}

const COUNT_WORDS = new Set([
  "pak",
  "pakken",
  "fles",
  "flessen",
  "doos",
  "dozen",
  "doosje",
  "doosjes",
  "zak",
  "zakken",
  "zakje",
  "zakjes",
  "pot",
  "potten",
  "potje",
  "potjes",
  "bakje",
  "bakjes",
  "blik",
  "blikken",
  "rol",
  "rollen",
  "bos",
  "bosje",
  "bosjes",
  "krop",
  "kroppen",
  "tros",
  "trossen",
  "stuk",
  "stuks",
  "gram",
  "gr",
  "kg",
  "kilo",
  "liter",
  "l",
  "ml",
  "x",
]);

/**
 * Telwoorden zoals je ze uitspreekt.
 *
 * Wie zijn lijstje intikt schrijft "3 pakken melk"; wie hem inspreekt zegt
 * "drie pakken melk", en de dicteerfunctie van de telefoon maakt daar geen
 * cijfer van. Zonder deze tabel belandde "drie" gewoon in de zoekterm en zocht
 * de app bij Picnic op "drie pakken melk".
 */
const SPOKEN_NUMBERS = new Map<string, number>([
  ["een", 1],
  ["één", 1],
  ["twee", 2],
  ["drie", 3],
  ["vier", 4],
  ["vijf", 5],
  ["zes", 6],
  ["zeven", 7],
  ["acht", 8],
  ["negen", 9],
  ["tien", 10],
  ["elf", 11],
  ["twaalf", 12],
]);

/**
 * Woorden waarmee een mens een lijstje inleidt, en die niets over het product
 * zeggen.
 *
 * "Doe maar twee zakken sperziebonen" is precies hoe je het zegt en precies
 * niet hoe je het zoekt. Alleen aan het begín weggehaald, en alleen woorden
 * die nooit een product zijn — "melk" en "brood" staan hier vanzelfsprekend
 * niet tussen.
 */
const LEAD_IN_WORDS = new Set([
  "doe",
  "maar",
  "ik",
  "wil",
  "we",
  "hebben",
  "moeten",
  "nog",
  "graag",
  "ook",
  "verder",
  "dan",
  "en",
  "even",
  "wat",
]);

/** En hoe je zo'n zin afsluit. */
const TRAILING_WORDS = new Set(["nodig", "kopen", "hebben", "graag"]);

function stripSpokenFiller(words: string[]): string[] {
  let start = 0;
  while (start < words.length && LEAD_IN_WORDS.has(words[start].toLowerCase())) start += 1;

  let end = words.length;
  while (end > start && TRAILING_WORDS.has(words[end - 1].toLowerCase())) end -= 1;

  // Alles was vulling: dan is er geen product genoemd en houden we de
  // oorspronkelijke woorden — liever een matige zoekopdracht dan een lege.
  return start >= end ? words : words.slice(start, end);
}

export function parseBulkFixedGroceryInput(input: string): ParsedBulkFixedGroceryLine[] {
  return (
    input
      // Ook op "en" splitsen, als heel woord. Ingesproken lijstjes hebben geen
      // regeleindes: "melk, brood en drie pakken hagelslag" is één zin, en
      // zonder deze splitsing zocht de app op die hele staart als één product.
      .split(/\n|,|;|\s+en\s+/i)
      .map((line) => line.trim().replace(/\s+/g, " "))
      .filter(Boolean)
      .map((raw) => {
        const words = stripSpokenFiller(raw.split(" "));
        if (words.length === 0) return { raw, searchTerm: raw, multiplier: 1 };

        const first = words[0].toLowerCase();
        const spoken = SPOKEN_NUMBERS.get(first);
        const digits = first.match(/^(\d+(?:[,.]\d+)?)$/);
        const multiplier = spoken ?? (digits ? Number(digits[1].replace(",", ".")) : null);

        // Geen aantal genoemd: dan is de hele regel de zoekterm.
        if (multiplier === null || !Number.isFinite(multiplier) || multiplier <= 0) {
          return { raw, searchTerm: words.join(" "), multiplier: 1 };
        }

        const rest = words.slice(1);
        if (rest.length === 0) return { raw, searchTerm: raw, multiplier: 1 };

        // "2 pakken melk" -> het verpakkingswoord hoort niet in de zoekopdracht.
        const withoutUnit = COUNT_WORDS.has(rest[0].toLowerCase()) ? rest.slice(1) : rest;
        const searchTerm = (withoutUnit.length > 0 ? withoutUnit : rest).join(" ");
        return { raw, searchTerm, multiplier };
      })
  );
}

export function removeBulkFixedGroceryLine(input: string, rawLineToRemove: string) {
  const normalizedRawLine = rawLineToRemove.trim().replace(/\s+/g, " ");
  let removed = false;
  return parseBulkFixedGroceryInput(input)
    .filter((line) => {
      if (!removed && line.raw === normalizedRawLine) {
        removed = true;
        return false;
      }
      return true;
    })
    .map((line) => line.raw)
    .join("\n");
}

export function inferIngredientCategory(searchTerm: string): IngredientCategory {
  const normalized = searchTerm.toLowerCase();
  if (/(appel|appels|banaan|bananen|peer|peren|fruit|druif|druiven|sinaasappel)/.test(normalized)) return "FRUIT";
  if (/(melk|yoghurt|kaas|boter|room)/.test(normalized)) return "DAIRY";
  if (/(kip|gehakt|rund|varken|spek|worst)/.test(normalized)) return "MEAT";
  if (/(sla|paprika|tomaat|komkommer|wortel|ui|aardappel|groente)/.test(normalized)) return "VEGETABLE";
  if (/(rijst|pasta|brood|wrap|couscous)/.test(normalized)) return "GRAIN";
  return "OTHER";
}
