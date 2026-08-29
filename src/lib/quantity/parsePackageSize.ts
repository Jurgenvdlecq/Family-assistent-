import type { Unit } from "@/generated/prisma/enums";

/**
 * Leidt een structureel Product.packageQuantity af uit Picnic's vrije
 * verpakkingstekst ("500 gram", "4 stuks", "9 rollen", "1 kg net").
 * Vertrouwt een match alléén als de herkende eenheid overeenkomt met de
 * eenheid van het gekoppelde ingrediënt — anders is de tekst ambigu (bv.
 * "1 kg net" uien terwijl recepten in stuks rekenen) en geeft deze functie
 * bewust `null` terug in plaats van te gokken. Geïnspireerd op
 * `verpakkingsGrootte()` uit Picnic-besteller (app.js), maar unit-bewust
 * herbouwd i.p.v. alleen stuks-patronen te herkennen.
 */

// Telwoorden die zeggen hoeveel er ín de verpakking zit. "9 rollen"
// toiletpapier had hiervóór helemaal geen verpakkingsinhoud: niet in de
// prijsvergelijking, en ook niet bij het uitrekenen hoeveel pakken je nodig
// hebt.
//
// Twee soorten woorden worden hier bewust wél/niet herkend:
//   - inhoudswoorden (rollen, plakken, sneetjes, zakjes, ...) tellen wat er
//     in de verpakking zit — die willen we;
//   - verpakkingswoorden in enkelvoud (pak, zak, fles, blik, doos) noemen de
//     verpakking zélf. "1 pak" brood zou dan 1 opleveren terwijl het recept
//     in sneetjes rekent, dus daar blijft `null` het eerlijke antwoord. De
//     meervoudsvormen staan er wél bij: "6 flessen" is een multipack, en dan
//     is 6 precies de inhoud.
//   - "bol(len)" ontbreekt bewust: een bol knoflook is niet hetzelfde als een
//     teentje, en recepten rekenen in teentjes. `parsePackContent` in de
//     prijslaag kent dat woord wél — daar gaat het alleen om een prijs per
//     stuk, en dan is een verkeerde aanname niet meer dan een ruwe
//     vergelijking; hier zou het de bestelhoeveelheid raken.
const NUMBER_UNIT_PATTERN =
  /(\d+(?:[.,]\d+)?)\s*(kilogram|kilo|kg|gram|g|liter|ml|stuks?|rollen|rol|zakjes|zakje|zakken|plakken|plak|sneetjes|sneetje|blikken|flessen|pakken|tabletten|tablet|capsules|capsule|doekjes|doekje|wasbeurten|wasbeurt|repen|reep)\b/gi;

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
    case "rol":
    case "rollen":
    case "zakje":
    case "zakjes":
    case "zakken":
    case "plak":
    case "plakken":
    case "sneetje":
    case "sneetjes":
    case "blikken":
    case "flessen":
    case "pakken":
    case "tablet":
    case "tabletten":
    case "capsule":
    case "capsules":
    case "doekje":
    case "doekjes":
    case "wasbeurt":
    case "wasbeurten":
    case "reep":
    case "repen":
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
