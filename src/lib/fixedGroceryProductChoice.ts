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
  "zak",
  "zakken",
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

export function parseBulkFixedGroceryInput(input: string): ParsedBulkFixedGroceryLine[] {
  return input
    .split(/\n|,|;/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .map((raw) => {
      const match = raw.match(/^(\d+(?:[,.]\d+)?)\s*(.*)$/);
      if (!match) return { raw, searchTerm: raw, multiplier: 1 };

      const multiplier = Number(match[1].replace(",", "."));
      const rest = match[2].trim();
      if (!Number.isFinite(multiplier) || multiplier <= 0 || !rest) {
        return { raw, searchTerm: raw, multiplier: 1 };
      }

      const parts = rest.split(" ");
      const searchTerm = COUNT_WORDS.has(parts[0]?.toLowerCase()) ? parts.slice(1).join(" ") : rest;
      return {
        raw,
        searchTerm: searchTerm || rest,
        multiplier,
      };
    });
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
