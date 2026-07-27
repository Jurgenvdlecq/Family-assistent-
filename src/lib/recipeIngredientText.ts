import { Unit, type IngredientCategory } from "@/generated/prisma/enums";

export interface ParsedRecipeIngredientLine {
  raw: string;
  name: string;
  quantity: number;
  unit: Unit;
  category: IngredientCategory;
}

const UNIT_ALIASES: Array<{ pattern: RegExp; unit: Unit; factor: number }> = [
  { pattern: /^(kg|kilo|kilogram)$/i, unit: Unit.GRAM, factor: 1000 },
  { pattern: /^(g|gr|gram)$/i, unit: Unit.GRAM, factor: 1 },
  { pattern: /^(l|liter)$/i, unit: Unit.ML, factor: 1000 },
  { pattern: /^(ml|milliliter)$/i, unit: Unit.ML, factor: 1 },
  { pattern: /^(x|stuk|stuks)$/i, unit: Unit.PIECE, factor: 1 },
];

const PACKAGING_WORDS = new Set([
  "pak",
  "pakken",
  "fles",
  "flessen",
  "doos",
  "dozen",
  "zak",
  "zakken",
  "bak",
  "bakje",
  "blik",
  "pot",
  "potje",
]);

function titleCase(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function inferRecipeIngredientCategory(name: string): IngredientCategory {
  const normalized = name.toLowerCase();
  if (/(kip|gehakt|rund|varken|spek|worst|ham|biefstuk|shoarma)/.test(normalized)) return "MEAT";
  if (/(zalm|tonijn|vis|garnalen|kabeljauw)/.test(normalized)) return "FISH";
  if (/(melk|yoghurt|kwark|kaas|boter|room|ei|eieren)/.test(normalized)) return "DAIRY";
  if (/(appel|banaan|peer|fruit|druif|sinaasappel|aardbei)/.test(normalized)) return "FRUIT";
  if (/(rijst|pasta|brood|wrap|couscous|bloem|noedel|mie)/.test(normalized)) return "GRAIN";
  if (/(boon|bonen|linzen|kikkererwt)/.test(normalized)) return "LEGUME";
  if (/(sla|paprika|tomaat|komkommer|wortel|ui|aardappel|broccoli|sperziebonen|groente|spinazie)/.test(normalized)) {
    return "VEGETABLE";
  }
  if (/(olie|saus|kruiden|peper|zout|bouillon|azijn)/.test(normalized)) return "PANTRY";
  return "OTHER";
}

function parseUnit(rawUnit: string | undefined) {
  if (!rawUnit) return null;
  const clean = rawUnit.trim().toLowerCase();
  for (const alias of UNIT_ALIASES) {
    if (alias.pattern.test(clean)) return alias;
  }
  return null;
}

function stripPackagingWord(value: string) {
  const parts = value.trim().split(/\s+/);
  if (PACKAGING_WORDS.has(parts[0]?.toLowerCase())) return parts.slice(1).join(" ");
  return value;
}

function stripPersonPrefix(value: string) {
  return value.replace(/^[^:]{1,32}:\s*/, "");
}

export function parseRecipeIngredientText(input: string): ParsedRecipeIngredientLine[] {
  const combined = new Map<string, ParsedRecipeIngredientLine>();

  for (const rawLine of input.split(/\n|,|;/)) {
    const raw = stripPersonPrefix(rawLine.trim().replace(/\s+/g, " "));
    if (!raw) continue;

    const compactMatch = raw.match(/^(\d+(?:[,.]\d+)?)(kg|kilo|kilogram|g|gr|gram|l|liter|ml|x|stuk|stuks)\s+(.+)$/i);
    const spacedMatch = raw.match(/^(\d+(?:[,.]\d+)?)\s+(.+)$/);

    let quantity = 1;
    let unit: Unit = Unit.PIECE;
    let name = raw;

    if (compactMatch) {
      const parsedUnit = parseUnit(compactMatch[2]);
      quantity = Number(compactMatch[1].replace(",", ".")) * (parsedUnit?.factor ?? 1);
      unit = parsedUnit?.unit ?? Unit.PIECE;
      name = compactMatch[3];
    } else if (spacedMatch) {
      const rest = spacedMatch[2].trim();
      const [firstWord = "", ...remainingWords] = rest.split(/\s+/);
      const maybeUnit = parseUnit(firstWord);
      const amount = Number(spacedMatch[1].replace(",", "."));
      if (Number.isFinite(amount) && amount > 0) {
        if (maybeUnit) {
          quantity = amount * maybeUnit.factor;
          unit = maybeUnit.unit;
          name = remainingWords.join(" ");
        } else {
          quantity = amount;
          unit = Unit.PIECE;
          name = stripPackagingWord(rest);
        }
      }
    }

    name = titleCase(stripPackagingWord(name));
    if (!name || !Number.isFinite(quantity) || quantity <= 0) continue;

    const key = `${name.toLowerCase()}:${unit}`;
    const existing = combined.get(key);
    if (existing) {
      existing.quantity += quantity;
    } else {
      combined.set(key, { raw, name, quantity, unit, category: inferRecipeIngredientCategory(name) });
    }
  }

  return Array.from(combined.values());
}
