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

/**
 * Woorden die een product als goedkoopste klasse markeren.
 *
 * Let op het onderscheid met `HOUSE_BRANDS` hierboven: een huismerk is de
 * standaardklasse, alleen een expliciet goedkopere lijn eronder is BUDGET.
 * Bij Albert Heijn is dat "AH Basic" naast het gewone "AH"; bij Dirk is dat
 * "G'woon" naast "1 de Beste".
 *
 * "1 de beste" stond hier eerst wél bij, en dat trok de hele vergelijking
 * met Dirk scheef: bijna elk Dirk-product draagt dat merk, dus bijna elke
 * Dirk-regel kreeg "voordeelmerk in plaats van wat jullie normaal kopen" en
 * verdween uit het harde totaal. Alleen A-merken bleven over. Het merk stond
 * bovendien al in `HOUSE_BRANDS`, dus het model sprak zichzelf tegen: de
 * budgetcontrole staat eerder en liet de huismerkregel nooit aan bod komen.
 */
const BUDGET_MARKERS = ["basic", "g'woon", "gwoon", "voordeel", "budget"];

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

  // Staat de winkelnaam vooraan in de productnaam, dan is het het huismerk van
  // die winkel — ook als het merkveld leeg is. "Picnic Hagelslag" ís de
  // hagelslag van Picnic. Dit is een aflezing en geen gok: alleen aan het
  // begin, en alleen voor de winkel waar het product vandaan komt. Zonder deze
  // regel bleef élk Picnic-product zonder merkveld "niet vast te stellen", en
  // dan valt er nergens iets te vergelijken.
  const name = normalize(input.name).trim();
  if (houseBrands.some((house) => name.startsWith(`${house} `))) return "STANDAARD";

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

/**
 * Vers of houdbaar?
 *
 * Dit is een aparte as naast de klasse, en hij is nodig voor precies het
 * voorbeeld waar de opdracht mee opent: AH verse halfvolle melk €1,29/l
 * tegenover AH houdbare halfvolle melk €0,85/l. Diezelfde winkel, hetzelfde
 * merk, dezelfde klasse — en tóch geen gelijkwaardig product. Zonder deze as
 * zou de vergelijking die 34% als "besparing" melden.
 *
 * `null` betekent onbekend. Twee keer onbekend is geen bezwaar (de meeste
 * producten zijn nu eenmaal niet houdbaar of vers gemarkeerd), maar
 * "houdbaar" tegenover "onbekend" telt wél als verschil — juist bij houdbare
 * varianten staat het er expliciet bij.
 */
export type Preservation = "VERS" | "HOUDBAAR";

/**
 * Woordstammen, geen losse letterreeksen. Zoeken op "vers" als deelreeks zou
 * ook aanslaan op "diverse"; en zoeken op precies "houdbaar" mist "houdbare",
 * wat nu juist de vorm is die op een pak melk staat. Beide fouten zijn met
 * een test aangetoond.
 */
const SHELF_STABLE_STEMS = ["houdbaar", "houdbare", "uht", "gesteriliseerd", "sterilised", "blik", "pot"];
const FRESH_STEMS = ["vers", "verse", "dagvers", "koeling", "gekoeld"];

function hasStem(value: string, stems: string[]): boolean {
  const words = normalize(value).trim().split(/\s+/);
  return words.some((word) => stems.some((stem) => word.startsWith(stem)));
}

export function derivePreservation(name: string, labels: string[] = []): Preservation | null {
  const haystack = `${name} ${labels.join(" ")}`;
  if (hasStem(haystack, SHELF_STABLE_STEMS)) return "HOUDBAAR";
  if (hasStem(haystack, FRESH_STEMS)) return "VERS";
  return null;
}

/**
 * Mogen deze twee als hetzelfde soort product gelden?
 *
 * Onbekend tegenover onbekend mag: dan zegt geen van beide partijen er iets
 * over, en dat is de normale situatie. Maar zodra één kant expliciet
 * "houdbaar" of "vers" zegt en de andere iets anders, is het een ander product.
 */
export function comparablePreservation(a: Preservation | null, b: Preservation | null): boolean {
  if (a === null && b === null) return true;
  return a === b;
}
