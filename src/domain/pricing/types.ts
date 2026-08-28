import type { ProductProvider, PromoType, Unit } from "@/generated/prisma/enums";
import type { UnitPrice } from "./unitPrice";

/**
 * Wat een winkelkoppeling wél en niet kan.
 *
 * Dit is bewust werkende code en geen documentatie: de vergelijker gebruikt
 * het om te weten wat hij mág concluderen (zonder EAN is een match nooit
 * "zeker"), en de schermen gebruiken het om te melden waar een prijs vandaan
 * komt. Zonder dit blok zou elke aanroeper zelf moeten onthouden dat Dirk
 * geen barcodes geeft — en dat vergeet er vroeg of laat één.
 */
export interface ProviderCapabilities {
  /** Levert de winkel een barcode? Alleen dan kan een match "identiek" heten. */
  hasEan: boolean;
  /** Levert de winkel gestructureerde allergeeninformatie? */
  hasAllergens: boolean;
  /** Levert de winkel een kant-en-klare prijs per liter/kilo/stuk? */
  hasUnitPrice: boolean;
  /** Kan de app hier daadwerkelijk bestellen, of is het alleen inzicht? */
  canOrder: boolean;
  /**
   * Hoe de gegevens binnenkomen. Een scrape is per definitie brozer dan een
   * API: de schermen zeggen dat erbij, en de bewaking is er strenger op.
   */
  reliability: "api" | "scrape";
}

/** Eén product zoals een winkel het aanlevert, al genormaliseerd. */
export interface ProviderProduct {
  provider: ProductProvider;
  /** De identificatie van de winkel zelf (webshopId, Picnic-id, Dirk-product-id). */
  externalRef: string;
  name: string;
  brand: string | null;
  /** Zoals de winkel het opschrijft: "1 l", "2 x 350 g". */
  packageSize: string | null;
  /** De inhoud in basiseenheden, of `null` als die niet betrouwbaar te lezen was. */
  content: { amount: number; unit: Unit } | null;
  price: number;
  /** De van-prijs bij een actie. */
  wasPrice: number | null;
  unitPrice: UnitPrice | null;
  promoType: PromoType;
  promoLabel: string | null;
  promoUntil: Date | null;
  /** Barcode; alleen gevuld als de winkel hem geeft. */
  gtin: string | null;
  /** Keurmerken/labels zoals de winkel ze meegeeft — voer voor de klassebepaling. */
  labels: string[];
  imageId: string | null;
}

/**
 * Eén winkelkoppeling. Bewust smal: zoeken en (waar mogelijk) verrijken.
 * Bestellen zit hier expliciet niet in — dat blijft bij Picnic en heeft zijn
 * eigen, veel voorzichtigere pad (`src/lib/picnic/cartService.ts`).
 */
export interface StorePriceProvider {
  provider: ProductProvider;
  /** Zoals de winkel in de app heet. */
  label: string;
  capabilities: ProviderCapabilities;
  /**
   * Zoekt producten bij deze winkel. Gooit bij een echte storing — een lege
   * uitslag en "de winkel is onbereikbaar" mogen nooit hetzelfde betekenen,
   * anders lijkt een kapotte koppeling op een winkel zonder aanbod.
   */
  search(term: string, options?: { limit?: number }): Promise<ProviderProduct[]>;
}

export const PROVIDER_LABELS: Record<ProductProvider, string> = {
  PICNIC: "Picnic",
  AH: "Albert Heijn",
  DIRK: "Dirk",
};
