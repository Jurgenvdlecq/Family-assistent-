import type { ProductProvider, QualityTier } from "@/generated/prisma/enums";

/**
 * In welke klasse valt dit product?
 *
 * Waarom dit bestaat: zonder klasse is "goedkoper" misleidend. Het voorbeeld
 * uit de opdracht is echt — AH verse halfvolle melk €1,29/l tegenover AH
 * houdbare halfvolle melk €0,85/l. Een matcher die stilletjes de tweede pakt,
 * meldt 34% besparing op iets wat je nooit gevraagd hebt.
 *
 * De belangrijkste regel staat aan het eind: **twijfel is `null`**, en `null`
 * betekent verderop "niet vergelijkbaar" — niet "waarschijnlijk wel goed".
 * Een klasse verzinnen om te kunnen vergelijken is precies de fout die dit
 * model moet voorkomen.
 */

/** Huismerken per winkel, zoals ze in de merknaam of producttitel staan. */
const HOUSE_BRANDS: Record<ProductProvider, string[]> = {
  AH: ["ah", "albert heijn", "ah basic", "ah huismerk", "ah excellent", "ah biologisch", "ah terra"],
  DIRK: ["dirk", "1 de beste", "1de beste", "g'woon", "gwoon"],
  PICNIC: ["picnic"],
};

/** Woorden die een product als goedkoopste klasse markeren. */
const BUDGET_MARKERS = ["basic", "1 de beste", "1de beste", "g'woon", "gwoon", "voordeel", "budget"];

/** Woorden en keurmerken die op biologisch duiden. */
const BIO_MARKERS = ["biologisch", "bio ", " bio", "organic", "eko", "demeter", "skal"];

/** Woorden en keurmerken die op een premiumlijn duiden. */
const PREMIUM_MARKERS = ["excellent", "delicieux", "premium", "ambachtelijk", "specialiteiten"];

function normalize(value: string): string {
  return ` ${value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")} `;
}

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle.toLowerCase()));
}

export interface QualityTierInput {
  provider: ProductProvider;
  name: string;
  brand?: string | null;
  /** Keurmerken zoals de winkel ze meegeeft (AH: `packagingMarking`). */
  labels?: string[];
}

/**
 * Bepaalt de klasse, of `null` als dat niet met genoeg zekerheid kan.
 *
 * Volgorde is niet willekeurig: bio gaat vóór huismerk, want "AH Biologische
 * melk" is een bioproduct dat toevallig ook huismerk is — en voor de
 * vergelijking is bio het onderscheid dat telt.
 */
export function deriveQualityTier(input: QualityTierInput): QualityTier | null {
  const haystack = normalize(`${input.brand ?? ""} ${input.name} ${(input.labels ?? []).join(" ")}`);

  if (containsAny(haystack, BIO_MARKERS)) return "BIO";
  if (containsAny(haystack, PREMIUM_MARKERS)) return "PREMIUM";
  if (containsAny(haystack, BUDGET_MARKERS)) return "BUDGET";

  const houseBrands = HOUSE_BRANDS[input.provider] ?? [];
  const brand = normalize(input.brand ?? "");
  // Het merk gelijk aan de winkelnaam betekent huismerk — dat is de
  // standaardklasse, niet de goedkoopste: AH's gewone huismerk staat tussen
  // budget en A-merk in.
  if (input.brand && houseBrands.some((house) => brand.trim() === house)) return "STANDAARD";

  // Een echt A-merk herkennen we niet betrouwbaar aan de naam alleen, en
  // gokken is hier duurder dan zwijgen.
  return input.brand ? "STANDAARD" : null;
}

/**
 * Vallen twee producten in dezelfde klasse?
 *
 * `null` aan één van beide kanten is nadrukkelijk géén match: onbekend is
 * onbekend, niet "waarschijnlijk hetzelfde".
 */
export function sameQualityTier(a: QualityTier | null, b: QualityTier | null): boolean {
  return a !== null && b !== null && a === b;
}

export const QUALITY_TIER_LABELS: Record<QualityTier, string> = {
  BUDGET: "voordeelmerk",
  STANDAARD: "huismerk",
  PREMIUM: "premium",
  BIO: "biologisch",
};
