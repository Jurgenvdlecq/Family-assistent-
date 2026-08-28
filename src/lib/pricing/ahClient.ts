import { logEvent, createCorrelationId, errorMessage } from "@/lib/logger";
import {
  AH_CAPABILITIES,
  toAhProviderProduct,
  readFreeFromAllergens,
  readGtin,
  readLabels,
  type AhProductDetail,
  type AhSearchProduct,
} from "@/domain/pricing/providers/ahProvider";
import type { ProviderProduct, StorePriceProvider } from "@/domain/pricing/types";

/**
 * De netwerkkant van de Albert Heijn-koppeling.
 *
 * Niet-officiële endpoints, alleen voor eigen gebruik en alleen om te kunnen
 * zien wat de boodschappenlijst elders zou kosten. Bestellen gebeurt nooit
 * hier — dat blijft bij Picnic, met zijn eigen bevestigingsstappen.
 *
 * Vormen en headers geverifieerd op 28-08-2026. De `X-Application`-header is
 * verplicht; zonder die header antwoordt AH met een 500.
 */

const AH_BASE_URL = process.env.AH_BASE_URL ?? "https://api.ah.nl";
const AH_CLIENT_ID = "appie";

/** Zoals een echte app zich meldt; zonder deze header werkt de zoek-API niet. */
const AH_HEADERS = {
  "X-Application": "AHWEBSHOP",
  "Content-Type": "application/json",
  Accept: "application/json",
} as const;

export class AhUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AhUnavailableError";
  }
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * Het anonieme token is ~7 dagen geldig. In-process bewaren is genoeg: dit
 * draait in een geplande taak, niet per paginabezoek, en een extra
 * tokenaanvraag is één goedkope aanroep. Bewust géén tabel ervoor — dat zou
 * schema-onderhoud opleveren voor iets wat vanzelf verloopt.
 */
let cachedToken: CachedToken | null = null;

/** Alleen voor tests: de tokencache leegmaken. */
export function resetAhTokenCache() {
  cachedToken = null;
}

export async function getAhAnonymousToken(now: Date = new Date()): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > now.getTime()) return cachedToken.token;

  const response = await fetch(`${AH_BASE_URL}/mobile-auth/v1/auth/token/anonymous`, {
    method: "POST",
    headers: AH_HEADERS,
    body: JSON.stringify({ clientId: AH_CLIENT_ID }),
  }).catch((error) => {
    throw new AhUnavailableError(`Geen verbinding met Albert Heijn: ${errorMessage(error)}`);
  });

  if (!response.ok) {
    throw new AhUnavailableError(`Albert Heijn gaf ${response.status} op de tokenaanvraag.`);
  }

  const body = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!body?.access_token) {
    throw new AhUnavailableError("Albert Heijn gaf een antwoord zonder token terug.");
  }

  // Een marge van een uur, zodat een token nooit halverwege een verversing
  // verloopt.
  const lifetimeMs = Math.max(60, (body.expires_in ?? 604798) - 3600) * 1000;
  cachedToken = { token: body.access_token, expiresAt: now.getTime() + lifetimeMs };
  return cachedToken.token;
}

async function ahGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${AH_BASE_URL}${path}`, {
    headers: { ...AH_HEADERS, Authorization: `Bearer ${token}` },
  }).catch((error) => {
    throw new AhUnavailableError(`Geen verbinding met Albert Heijn: ${errorMessage(error)}`);
  });

  if (!response.ok) {
    throw new AhUnavailableError(`Albert Heijn gaf ${response.status} op ${path}.`);
  }
  return (await response.json()) as T;
}

/**
 * Zoekt producten bij AH.
 *
 * Gooit bij een storing in plaats van een lege lijst terug te geven: "geen
 * resultaten" en "de winkel is onbereikbaar" mogen nooit hetzelfde betekenen,
 * anders lijkt een kapotte koppeling op een winkel zonder aanbod — en dan
 * lijkt AH ineens gratis.
 */
export async function searchAhProducts(term: string, limit = 10): Promise<ProviderProduct[]> {
  const token = await getAhAnonymousToken();
  const query = new URLSearchParams({ query: term, size: String(limit) });
  const body = await ahGet<{ products?: AhSearchProduct[] }>(
    `/mobile-services/product/search/v2?${query.toString()}`,
    token
  );

  const products = (body.products ?? [])
    .map(toAhProviderProduct)
    .filter((product): product is ProviderProduct => product !== null);

  logEvent({
    level: "info",
    area: "pricing",
    message: "Albert Heijn doorzocht",
    correlationId: createCorrelationId(),
    meta: { term, found: products.length },
  });
  return products;
}

export interface AhProductExtras {
  gtin: string | null;
  /** Waar dit product gegarandeerd vrij van is, in de tags van de app zelf. */
  freeFromAllergens: string[];
  labels: string[];
}

/**
 * Haalt de gegevens op die alleen op het detailscherm staan: de barcode, de
 * allergeeninformatie en de keurmerken.
 *
 * Bewust apart van het zoeken: dit is één aanroep per product, en dat hoeft
 * alleen voor producten die we daadwerkelijk gaan gebruiken.
 */
export async function fetchAhProductExtras(webshopId: string): Promise<AhProductExtras> {
  const token = await getAhAnonymousToken();
  const detail = await ahGet<AhProductDetail>(
    `/mobile-services/product/detail/v4/fir/${encodeURIComponent(webshopId)}`,
    token
  );
  return {
    gtin: readGtin(detail),
    freeFromAllergens: readFreeFromAllergens(detail),
    labels: readLabels(detail),
  };
}

export const ahPriceProvider: StorePriceProvider = {
  provider: "AH",
  label: "Albert Heijn",
  capabilities: AH_CAPABILITIES,
  search: (term, options) => searchAhProducts(term, options?.limit ?? 10),
};
