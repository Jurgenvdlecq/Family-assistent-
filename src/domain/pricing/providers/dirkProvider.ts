import type { ProviderCapabilities, ProviderProduct } from "../types";
import { parsePackContent, unitPriceFor } from "../unitPrice";

/**
 * Dirk: het lezen van de pagina's.
 *
 * Dirk heeft geen API. De site rendert server-side, dus de prijzen staan
 * gewoon in de HTML — maar de zoekpagina laadt client-side en is daarmee
 * onbruikbaar. Daarom crawlen we categorieën naar een eigen index en zoeken
 * we daar zelf in (`src/lib/pricing/dirkClient.ts`).
 *
 * Net als bij Albert Heijn staat het ontleden los van het netwerkdeel, zodat
 * het zonder internet te testen is. Het verschil is dat dit een scrape is:
 * de vorm van de pagina is niet afgesproken en kan zonder aankondiging
 * veranderen. Alle regels hieronder zijn daarom defensief — wat niet
 * ondubbelzinnig te lezen is, wordt overgeslagen in plaats van geraden — en
 * nul gevonden producten geldt verderop als een storing, niet als een lege
 * uitslag.
 */

export const DIRK_CAPABILITIES: ProviderCapabilities = {
  // Dirk geeft geen barcode. Een match kan hier dus nooit "identiek op
  // barcode" zijn; het ingrediënt blijft de ruggengraat.
  hasEan: false,
  hasAllergens: false,
  // Geen kant-en-klare eenheidsprijs: die leiden we zelf af uit de
  // verpakkingsgrootte, en alleen als die betrouwbaar te lezen was.
  hasUnitPrice: false,
  canOrder: false,
  reliability: "scrape",
};

/**
 * De prijs staat gesplitst in de HTML, en de klasse `hasEuros` bepaalt hoe je
 * de twee helften moet lezen.
 *
 * Dit is de enige echte valkuil in deze pagina: zonder die klasse mee te
 * wegen leest "89 cent" als € 89,00 — en dan is Dirk ineens honderd keer zo
 * duur, of (erger, bij de omgekeerde fout) honderd keer zo goedkoop.
 */
export function parseDirkPrice(large: string, small: string, hasEuros: boolean): number | null {
  const euros = large.replace(/\D/g, "");
  const cents = small.replace(/\D/g, "");
  if (!euros && !cents) return null;

  if (hasEuros) {
    // Het eerste getal zijn hele euro's, het tweede de centen.
    const value = Number(`${euros || "0"}.${(cents || "0").padEnd(2, "0").slice(0, 2)}`);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  // Zonder `hasEuros` staat de hele prijs in centen, verdeeld over de twee
  // helften — "89" en "" of "8" en "9" leveren allebei € 0,89 op.
  const value = Number(`${euros}${cents}`) / 100;
  return Number.isFinite(value) && value > 0 ? Number(value.toFixed(2)) : null;
}

/** Het Dirk-product-ID is het laatste getal in de product-URL. */
export function parseDirkProductId(href: string): string | null {
  const match = href.match(/(\d+)(?:[/?#][^/]*)?$/);
  return match ? match[1] : null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * De naam van het product uit een stuk HTML.
 *
 * Meerdere kansen, van betrouwbaar naar minder betrouwbaar. In webshopmarkup
 * is het `alt`-attribuut van de productafbeelding het stabielst; een kop of
 * de linktekst is het vangnet. Levert geen van alle iets bruikbaars op, dan
 * `null` — een product zonder naam is niet te matchen en hoort dus niet in
 * de index.
 */
function parseName(chunk: string): string | null {
  const candidates = [
    chunk.match(/alt="([^"]{3,120})"/)?.[1],
    chunk.match(/title="([^"]{3,120})"/)?.[1],
    chunk.match(/<h[1-6][^>]*>([\s\S]{3,200}?)<\/h[1-6]>/)?.[1],
    chunk.match(/class="[^"]*(?:product-?name|product-?title)[^"]*"[^>]*>([\s\S]{3,200}?)</)?.[1],
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const text = textOf(candidate);
    // Losse woorden als "Bekijk" of "Aanbieding" zijn geen productnaam.
    if (text.length >= 3 && /[a-zA-Z]{3}/.test(text)) return text;
  }
  return null;
}

/**
 * De verpakkingsgrootte, zoals ze op de pagina staat.
 *
 * Gezocht in de tekst van het blok, niet in een specifieke klasse: de klasse
 * is precies het soort ding dat bij een herontwerp verandert, de notatie
 * "500 ml" niet.
 */
function parsePackageSize(chunk: string): string | null {
  const text = textOf(chunk);
  const match = text.match(/\b\d+(?:[.,]\d+)?\s*(?:x\s*\d+(?:[.,]\d+)?\s*)?(?:gram|kg|g|ml|cl|liter|l|stuks|stuk|st)\b/i);
  return match ? match[0].trim() : null;
}

/** Het merk staat bij Dirk niet apart in de opsomming; alleen de naam is er. */
const DIRK_HOUSE_BRANDS = ["1 de beste", "1de beste", "g'woon", "gwoon", "dirk"];

/**
 * Het merk uit de productnaam, voor zover het een huismerk van Dirk is.
 *
 * Bewust beperkt tot wat we zeker weten. Het eerste woord van een productnaam
 * als merk nemen zou "Verse" tot merk maken, en een verzonnen merk werkt door
 * in de klassebepaling — precies waar het equivalentiemodel geen gokwerk
 * verdraagt.
 */
export function parseDirkBrand(name: string): string | null {
  const lower = name.toLowerCase();
  const found = DIRK_HOUSE_BRANDS.find((brand) => lower.includes(brand));
  return found ? name.slice(lower.indexOf(found), lower.indexOf(found) + found.length) : null;
}

/** Ruim genoeg voor "€ 1,29" in opmaak, klein genoeg om niet in de volgende kaart te belanden. */
const PRICE_BLOCK_WINDOW = 400;

/**
 * Staat `hasEuros` op dit prijselement?
 *
 * Gekeken naar het hele tag, want de volgorde van klassen ligt niet vast:
 * `class="price-large hasEuros"` en `class="hasEuros price-large"` moeten
 * allebei tellen, en een `hasEuros` van de buurkaart mag niet meetellen.
 */
function hasEurosClass(html: string, priceLargeIndex: number): boolean {
  const tagStart = html.lastIndexOf("<", priceLargeIndex);
  const tagEnd = html.indexOf(">", priceLargeIndex);
  if (tagStart === -1 || tagEnd === -1) return false;
  return html.slice(tagStart, tagEnd).includes("hasEuros");
}

/**
 * Alle producten op één categoriepagina.
 *
 * De blokken worden afgebakend op de prijsopmaak (`price-large`), omdat dat
 * het enige stuk structuur is dat we van deze pagina echt kennen. Alles
 * daarbuiten — welke `div` een productkaart is, hoe de naam is opgemaakt —
 * is een aanname, en dus een vangnet met meerdere kansen in plaats van één
 * harde selector.
 */
export function parseDirkProducts(html: string): ProviderProduct[] {
  const priceMarkers = [...html.matchAll(/price-large/g)].map((match) => match.index ?? 0);
  if (priceMarkers.length === 0) return [];

  const products: ProviderProduct[] = [];
  const seen = new Set<string>();
  // Waar het prijsblok van de vórige kaart ophield. Alles tussen dat punt en
  // de prijs van deze kaart hoort bij déze kaart — de prijs staat onderaan de
  // productkaart, dus de link en de naam staan eráchter, niet ervoor. Zonder
  // dit onderscheid pakt een kaart de naam van zijn buurman.
  let previousPriceEnd = 0;

  for (const start of priceMarkers) {
    const priceBlock = html.slice(start, start + PRICE_BLOCK_WINDOW);
    const large = priceBlock.match(/price-large[^>]*>([\s\S]{0,40}?)</)?.[1] ?? "";
    const smallMatch = priceBlock.match(/price-small[^>]*>([\s\S]{0,40}?)</);
    const small = smallMatch?.[1] ?? "";

    const chunk = html.slice(previousPriceEnd, start);
    previousPriceEnd =
      smallMatch?.index !== undefined ? start + smallMatch.index + smallMatch[0].length : start + 1;

    const price = parseDirkPrice(large, small, hasEurosClass(html, start));
    if (price === null) continue;

    const href = [...chunk.matchAll(/href="([^"]*\/\d+[^"]*)"/g)].map((match) => match[1]).pop();
    const externalRef = href ? parseDirkProductId(href) : null;
    const name = parseName(chunk);
    // Zonder id of naam valt er niets op te slaan en niets te matchen.
    if (!externalRef || !name || seen.has(externalRef)) continue;
    seen.add(externalRef);

    const packageSize = parsePackageSize(chunk);
    const content = parsePackContent(packageSize);

    products.push({
      provider: "DIRK",
      externalRef,
      name,
      brand: parseDirkBrand(name),
      packageSize,
      content,
      price,
      // De van-prijs staat op de aanbiedingenpagina, niet in de categorie.
      wasPrice: null,
      unitPrice: unitPriceFor(price, content),
      promoType: "GEEN",
      promoLabel: null,
      promoUntil: null,
      gtin: null,
      labels: [],
      freeFromAllergens: [],
      imageId: null,
    });
  }

  return products;
}

/**
 * De categoriepagina's uit de overzichtspagina.
 *
 * Bewust uit de site zelf gelezen in plaats van een vaste lijst in de code:
 * een lijst met verzonnen of verouderde categorieën levert stilletjes minder
 * producten op, en dat is precies het soort stille fout dat deze koppeling
 * niet mag hebben.
 */
export function parseDirkCategoryPaths(html: string): string[] {
  const paths = [...html.matchAll(/href="(\/boodschappen\/[a-z0-9-]+\/[a-z0-9-]+[^"]*)"/gi)]
    .map((match) => match[1].split("?")[0].replace(/\/$/, ""));
  return [...new Set(paths)];
}
