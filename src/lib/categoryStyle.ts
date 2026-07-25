// Geen productfoto's beschikbaar (geen Picnic-productafbeeldingen-API) — een
// zachte, per-categorie kleurverloop-tegel doet dienst als visuele anker per
// gerecht, in plaats van te doen alsof er een echte foto staat.
export const CATEGORY_GRADIENT: Record<string, string> = {
  PASTA: "from-amber-200 to-orange-300",
  WRAPS: "from-lime-200 to-green-300",
  RICE_DISH: "from-yellow-200 to-amber-300",
  ALL_VEGGIE_DAY: "from-green-200 to-emerald-300",
  QUICK_AND_EASY: "from-sky-200 to-blue-300",
  COMFORT_FOOD: "from-rose-200 to-red-300",
  AIRFRYER: "from-violet-200 to-purple-300",
  OTHER: "from-teal-200 to-cyan-300",
};

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

export type TagTone = "blue" | "green" | "amber" | "purple" | "pink";

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
