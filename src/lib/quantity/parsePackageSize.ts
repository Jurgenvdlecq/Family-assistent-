import type { Unit } from "@/generated/prisma/enums";

/**
 * Leidt een structureel Product.packageQuantity af uit Picnic's vrije
 * verpakkingstekst ("500 gram", "4 stuks", "1 kg net"). Vertrouwt een match
 * alléén als de herkende eenheid overeenkomt met de eenheid van het
 * gekoppelde ingrediënt — anders is de tekst ambigu (bv. "3 bollen"
 * knoflook, of "1 kg net" uien terwijl recepten in stuks rekenen) en geeft
 * deze functie bewust `null` terug in plaats van te gokken. Geïnspireerd op
 * `verpakkingsGrootte()` uit Picnic-besteller (app.js), maar unit-bewust
 * herbouwd i.p.v. alleen stuks-patronen te herkennen.
 */

const NUMBER_UNIT_PATTERN =
  /(\d+(?:[.,]\d+)?)\s*(kilogram|kilo|kg|gram|g|liter|ml|stuks?)\b/gi;

function toBaseUnit(rawUnit: string): { multiplier: number; unit: Unit } | null {
  switch (rawUnit.toLowerCase()) {
    case "kilogram":
    case "kilo":
    case "kg":
      return { multiplier: 1000, unit: "GRAM" };
    case "gram":
    case "g":
      return { multiplier: 1, unit: "GRAM" };
    case "liter":
      return { multiplier: 1000, unit: "ML" };
    case "ml":
      return { multiplier: 1, unit: "ML" };
    case "stuk":
    case "stuks":
      return { multiplier: 1, unit: "PIECE" };
    default:
      return null;
  }
}

export function parsePackageQuantity(
  packageSize: string | null | undefined,
  ingredientUnit: Unit
): number | null {
  if (!packageSize) return null;

  for (const match of packageSize.matchAll(NUMBER_UNIT_PATTERN)) {
    const converted = toBaseUnit(match[2]);
    if (converted && converted.unit === ingredientUnit) {
      const amount = parseFloat(match[1].replace(",", "."));
      if (Number.isFinite(amount) && amount > 0) {
        return amount * converted.multiplier;
      }
    }
  }

  // Geen expliciet getal gevonden dat bij de ingrediënt-eenheid past — een
  // handjevol vaste, ondubbelzinnige uitzonderingen ("per stuk" betekent
  // letterlijk 1 stuk per verpakking; "per kilo" is losse waar die per kilo
  // wordt afgerekend, dus in kilo-stappen).
  const trimmed = packageSize.trim().toLowerCase();
  if (trimmed === "per stuk" && ingredientUnit === "PIECE") return 1;
  if (trimmed === "per kilo" && ingredientUnit === "GRAM") return 1000;
  if (trimmed === "per liter" && ingredientUnit === "ML") return 1000;

  return null;
}
