import type { PromoType } from "@/generated/prisma/enums";
import type { ProviderCapabilities, ProviderProduct } from "../types";
import { parsePackContent, parseUnitPriceDescription, unitPriceFor } from "../unitPrice";

/**
 * Albert Heijn: het lezen van de antwoorden.
 *
 * Bewust gescheiden van het netwerkdeel (`src/lib/pricing/ahClient.ts`): het
 * ontleden is de plek waar fouten zitten die je met een test kunt vangen, en
 * die test moet geen internet nodig hebben.
 *
 * Vormen geverifieerd op 28-08-2026 (zie de opdracht). Alles is defensief
 * gelezen: een veld dat ontbreekt of een andere vorm heeft leidt tot "onbekend"
 * en nooit tot een verzonnen prijs.
 */

export const AH_CAPABILITIES: ProviderCapabilities = {
  // AH geeft de barcode mee op het detailscherm — daarmee kan een match van
  // "waarschijnlijk" naar "zeker" gaan, mits de andere kant hem ook heeft.
  hasEan: true,
  hasAllergens: true,
  hasUnitPrice: true,
  // Alleen inzicht: bestellen blijft bij Picnic.
  canOrder: false,
  reliability: "api",
};

export interface AhSearchProduct {
  webshopId?: number | string;
  title?: string;
  brand?: string;
  salesUnitSize?: string;
  priceBeforeBonus?: number;
  currentPrice?: number;
  isBonus?: boolean;
  discountLabels?: Array<{ code?: string; defaultDescription?: string; description?: string; price?: number }>;
  unitPriceDescription?: string;
  bonusStartDate?: string;
  bonusEndDate?: string;
  propertyIcons?: string[];
  images?: Array<{ url?: string }>;
}

/**
 * Vertaalt het kortingslabel van AH naar een mechanisme.
 *
 * Bewust grof: het gaat erom of een korting mechanisch is ("1+1 gratis",
 * "2e halve prijs") of gewoon een lagere prijs. Het exacte percentage
 * uitrekenen hoort bij het doorrekenen van het mandje, niet bij het lezen van
 * een label.
 */
export function parsePromoType(labels: AhSearchProduct["discountLabels"], isBonus: boolean | undefined): PromoType {
  const text = (labels ?? [])
    .map((label) => `${label.code ?? ""} ${label.defaultDescription ?? ""} ${label.description ?? ""}`)
    .join(" ")
    .toLowerCase();

  if (/\d\s*\+\s*\d|halve prijs|tweede|2e/.test(text)) return "X_VOOR_Y";
  if (/\d\s*voor\b/.test(text)) return "X_VOOR_Y";
  if (/stapel|volume|meer korting/.test(text)) return "VOLUME";
  if (isBonus) return "BONUS";
  return "GEEN";
}

function promoLabelOf(labels: AhSearchProduct["discountLabels"]): string | null {
  const first = (labels ?? []).find((label) => label.defaultDescription || label.description);
  return first?.defaultDescription ?? first?.description ?? null;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Eén zoekresultaat naar de gedeelde vorm.
 *
 * Geeft `null` bij een resultaat zonder id of zonder bruikbare prijs — zo'n
 * regel overslaan is beter dan hem met prijs nul in de vergelijking laten
 * meedoen, want dan lijkt AH goedkoper dan hij is.
 */
export function toAhProviderProduct(raw: AhSearchProduct): ProviderProduct | null {
  const externalRef = raw.webshopId === undefined || raw.webshopId === null ? null : String(raw.webshopId);
  const price = positiveNumber(raw.currentPrice) ?? positiveNumber(raw.priceBeforeBonus);
  if (!externalRef || price === null || !raw.title) return null;

  const wasPrice = positiveNumber(raw.priceBeforeBonus);
  const content = parsePackContent(raw.salesUnitSize);
  // AH levert de eenheidsprijs kant-en-klaar mee; die is betrouwbaarder dan
  // zelf delen op een verpakkingsgrootte die we misschien verkeerd lezen.
  const unitPrice = parseUnitPriceDescription(raw.unitPriceDescription) ?? unitPriceFor(price, content);

  return {
    provider: "AH",
    externalRef,
    name: raw.title,
    brand: raw.brand ?? null,
    packageSize: raw.salesUnitSize ?? null,
    content,
    price,
    // Alleen een van-prijs melden als hij écht hoger is dan de huidige prijs.
    // AH vult `priceBeforeBonus` ook als er niets in de bonus is, en dan zou
    // "van €1,29 voor €1,29" een korting suggereren die er niet is.
    wasPrice: wasPrice !== null && wasPrice > price ? wasPrice : null,
    unitPrice,
    promoType: parsePromoType(raw.discountLabels, raw.isBonus),
    promoLabel: promoLabelOf(raw.discountLabels),
    promoUntil: parseDate(raw.bonusEndDate),
    // De barcode zit alleen op het detailscherm, niet in het zoekresultaat.
    gtin: null,
    labels: raw.propertyIcons ?? [],
    freeFromAllergens: [],
    imageId: null,
    // De productpagina van AH is uit het webshop-id te vormen. Dat is dezelfde
    // id die we toch al als externalRef bewaren.
    url: ahProductUrl(externalRef),
  };
}

/**
 * De publieke productpagina van Albert Heijn.
 *
 * Anders dan bij Dirk is dit geen gelezen link maar een **patroon**: AH geeft
 * in het zoekantwoord geen URL mee, alleen het webshop-id, en `wi<id>` is de
 * vorm die de site daarvoor gebruikt. Het id komt dus wel uit de winkeldata,
 * de vorm eromheen is onze aanname. Laat AH het `wi`-voorvoegsel ooit vallen,
 * dan wijzen deze links stil naar een foutpagina — daar is geen bewaking op,
 * want een link die niet werkt is van buitenaf niet van een goede te
 * onderscheiden. De link staat er daarom als hulpmiddel om na te kijken, niet
 * als iets waar de app zelf op leunt.
 */
export function ahProductUrl(webshopId: string): string {
  return `https://www.ah.nl/producten/product/wi${encodeURIComponent(webshopId)}`;
}

export interface AhProductDetail {
  productCard?: { webshopId?: number | string };
  tradeItem?: {
    gtin?: string;
    allergenInformation?: Array<{ allergenTypeCode?: string; levelOfContainmentCode?: string }>;
    packagingMarking?: { labels?: string[] };
  };
}

/** De barcode van het detailscherm; `null` als AH hem niet meegeeft. */
export function readGtin(detail: AhProductDetail): string | null {
  const gtin = detail.tradeItem?.gtin;
  return typeof gtin === "string" && gtin.trim().length > 0 ? gtin.trim() : null;
}

/**
 * Waar dit product gegarandeerd vrij van is, in de woorden van het
 * gecontroleerde vocabulaire van de app (`src/lib/dietaryRestrictions.ts`).
 *
 * Alleen `FREE_FROM` telt. `MAY_CONTAIN` is nadrukkelijk géén garantie, en
 * `CONTAINS` zegt iets anders. Bij een allergie is "waarschijnlijk vrij van"
 * gelijk aan onbruikbaar — dus alles wat niet expliciet FREE_FROM is, telt
 * hier niet mee.
 */
export function readFreeFromAllergens(detail: AhProductDetail): string[] {
  const entries = detail.tradeItem?.allergenInformation ?? [];
  const freeFrom = entries
    .filter((entry) => (entry.levelOfContainmentCode ?? "").toUpperCase() === "FREE_FROM")
    .map((entry) => (entry.allergenTypeCode ?? "").toUpperCase());

  const mapped = new Set<string>();
  for (const code of freeFrom) {
    const tag = AH_ALLERGEN_TAGS[code];
    if (tag) mapped.add(tag);
  }
  return [...mapped].sort();
}

/**
 * AH-allergeencodes naar de tags die de app zelf al gebruikt. Bewust een
 * kleine, expliciete lijst: een code die hier niet in staat wordt genegeerd,
 * niet geraden.
 */
const AH_ALLERGEN_TAGS: Record<string, string> = {
  AF: "vis",
  FISH: "vis",
  AE: "ei",
  EGG: "ei",
  AM: "lactose",
  MILK: "lactose",
  AP: "pinda",
  PEANUTS: "pinda",
  AN: "noten",
  NUTS: "noten",
  AW: "gluten",
  GLUTEN: "gluten",
  UW: "gluten",
  AS: "soja",
  SOY: "soja",
};

export function readLabels(detail: AhProductDetail): string[] {
  return detail.tradeItem?.packagingMarking?.labels ?? [];
}
