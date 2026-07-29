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

const FROZEN_PRODUCT_PATTERN = /diepvries|ingevroren|vrieskast|vriezer/i;
const PRESERVED_PRODUCT_PATTERN = /\bblik\b|\bpot(je)?\b|conserven/i;

// Ingredientcategorie (vlees, groente, ...) zegt niets over hóé het dit
// weekmenu daadwerkelijk wordt ingekocht — verse doperwten en diepvries-
// doperwten hebben allebei categorie VEGETABLE. Als er al een echt gekozen
// product bekend is (deze week op de boodschappenlijst, of de onthouden
// standaardkeuze), leest deze functie eerst de productnaam om diepvries/
// blik-varianten te herkennen; alleen zonder bekend product valt hij terug
// op de categorie als grove inschatting.
export function ingredientFreshness(
  category: string,
  productName?: string | null,
): { label: string; tone: TagTone } {
  if (productName) {
    if (FROZEN_PRODUCT_PATTERN.test(productName)) return { label: "Diepvries", tone: "blue" };
    if (PRESERVED_PRODUCT_PATTERN.test(productName)) return { label: "Blik/pot", tone: "amber" };
  }
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
