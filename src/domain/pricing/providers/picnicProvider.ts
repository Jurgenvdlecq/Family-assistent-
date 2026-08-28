import type { ProviderProduct, StorePriceProvider } from "../types";
import { parsePackContent, unitPriceFor } from "../unitPrice";

/**
 * Picnic achter dezelfde interface als de andere winkels.
 *
 * Waarom dat nuttig is terwijl Picnic al een eigen client heeft: de
 * vergelijking moet alle winkels op precies dezelfde manier behandelen. Zou
 * Picnic een uitzondering blijven, dan sluipt er ongemerkt een verschil in —
 * bijvoorbeeld een eenheidsprijs die voor AH wél en voor Picnic niet wordt
 * uitgerekend, waarna Picnic er structureel anders uitziet dan het is.
 *
 * Deze provider haalt zelf niets op. Het zoeken bij Picnic gebeurt al in
 * `src/lib/picnic/*` met de sessie van het huishouden; hier wordt alleen
 * vertaald naar de gedeelde vorm.
 */

export interface PicnicSearchItemLike {
  id?: string;
  name?: string;
  display_price?: number;
  price?: number;
  unit_quantity?: string;
  image_id?: string;
}

/** Picnic geeft bedragen in centen. */
function toEuros(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value / 100;
}

/**
 * Zet één Picnic-zoekresultaat om naar de gedeelde vorm. Geeft `null` bij een
 * resultaat zonder bruikbare prijs of id — dat overslaan is beter dan een
 * regel met een prijs van nul.
 */
export function toPicnicProviderProduct(item: PicnicSearchItemLike): ProviderProduct | null {
  const price = toEuros(item.display_price ?? item.price);
  if (!item.id || price === null) return null;

  const content = parsePackContent(item.unit_quantity);
  return {
    provider: "PICNIC",
    externalRef: item.id,
    name: item.name ?? "Onbekend product",
    // Picnic levert geen apart merkveld; het merk zit in de productnaam.
    brand: null,
    packageSize: item.unit_quantity ?? null,
    content,
    price,
    wasPrice: null,
    unitPrice: unitPriceFor(price, content),
    // Picnic geeft acties niet gestructureerd terug; die stilzwijgend
    // afleiden uit de naam zou verzonnen informatie zijn.
    promoType: "GEEN",
    promoLabel: null,
    promoUntil: null,
    // Onbekend of Picnic een barcode heeft — dat staat als openstaand punt in
    // de opdracht. Zolang dat zo is, kan een Picnic-match nooit "identiek op
    // barcode" heten, alleen "gelijkwaardig".
    gtin: null,
    labels: [],
    freeFromAllergens: [],
    imageId: item.image_id ?? null,
  };
}

export const picnicPriceProvider: StorePriceProvider = {
  provider: "PICNIC",
  label: "Picnic",
  capabilities: {
    hasEan: false,
    hasAllergens: false,
    hasUnitPrice: false,
    canOrder: true,
    reliability: "api",
  },
  async search() {
    // Bewust niet geïmplementeerd: zoeken bij Picnic vereist de sessie van een
    // specifiek huishouden en gebeurt in `src/lib/picnic/products.ts`. Hier
    // stilzwijgend een lege lijst teruggeven zou betekenen dat de vergelijker
    // denkt dat Picnic niets verkoopt.
    throw new Error(
      "Zoeken bij Picnic loopt via de huishoudsessie (src/lib/picnic/products.ts), niet via deze provider."
    );
  },
};
