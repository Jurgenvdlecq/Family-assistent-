export const CATEGORY_LABELS: Record<string, string> = {
  PASTA: "Pasta",
  WRAPS: "Wraps",
  RICE_DISH: "Rijstgerechten",
  ALL_VEGGIE_DAY: "Vegetarisch (AVG)",
  QUICK_AND_EASY: "Snel & makkelijk",
  COMFORT_FOOD: "Comfortfood",
  AIRFRYER: "Airfryer",
  OTHER: "Overig",
};

export const VARIANT_LABELS: Record<string, string> = {
  FAST: "Snel & makkelijk",
  FRESH: "Vers",
  REHEATABLE: "Opwarmbaar",
  KID_FRIENDLY: "Kindvriendelijk",
};

export const STATUS_LABELS: Record<string, string> = {
  FOUND: "Nieuwe suggestie",
  ADAPTED: "Nieuwe suggestie",
  PROVEN: "Beproefd",
  SAFE_CHOICE: "Favoriet",
};

export const UNIT_LABELS: Record<string, string> = { GRAM: "g", ML: "ml", PIECE: "x" };

export type TagTone = "blue" | "green" | "amber" | "purple" | "pink";

// Geen aparte "verspercentage"-data per ingrediënt — deze indeling leunt op
// de bestaande IngredientCategory om aan te geven of iets vers ingekocht
// wordt (vlees, vis, zuivel, groente, fruit) of juist houdbaar/verpakt is
// (graan, peulvrucht, voorraadkast), zodat een gebruiker in één oogopslag
// snapt hoe een gerecht ongeveer tot stand komt.
export function ingredientFreshness(category: string): { label: string; tone: TagTone } {
  if (["MEAT", "FISH", "DAIRY", "VEGETABLE", "FRUIT"].includes(category)) {
    return { label: "Vers", tone: "green" };
  }
  if (["GRAIN", "LEGUME", "PANTRY"].includes(category)) {
    return { label: "Houdbaar/pak", tone: "amber" };
  }
  return { label: "Overig", tone: "blue" };
}

export function statusTone(status: string): TagTone {
  if (status === "SAFE_CHOICE") return "green";
  if (status === "PROVEN") return "blue";
  return "amber";
}

export function variantTone(variantType: string): TagTone {
  if (variantType === "FAST") return "blue";
  if (variantType === "REHEATABLE") return "purple";
  if (variantType === "KID_FRIENDLY") return "pink";
  return "green";
}
