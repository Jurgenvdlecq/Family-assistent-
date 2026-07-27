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

export function inferIngredientCategory(searchTerm: string): IngredientCategory {
  const normalized = searchTerm.toLowerCase();
  if (/(appel|appels|banaan|bananen|peer|peren|fruit|druif|druiven|sinaasappel)/.test(normalized)) return "FRUIT";
  if (/(melk|yoghurt|kaas|boter|room)/.test(normalized)) return "DAIRY";
  if (/(kip|gehakt|rund|varken|spek|worst)/.test(normalized)) return "MEAT";
  if (/(sla|paprika|tomaat|komkommer|wortel|ui|aardappel|groente)/.test(normalized)) return "VEGETABLE";
  if (/(rijst|pasta|brood|wrap|couscous)/.test(normalized)) return "GRAIN";
  return "OTHER";
}
