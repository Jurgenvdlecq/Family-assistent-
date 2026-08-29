import { logEvent, createCorrelationId, errorMessage } from "@/lib/logger";
import {
  DIRK_CAPABILITIES,
  parseDirkCategoryPaths,
  parseDirkProducts,
} from "@/domain/pricing/providers/dirkProvider";
import { rankStoreProducts } from "@/domain/pricing/storeMatch";
import type { ProviderProduct, StorePriceProvider } from "@/domain/pricing/types";

/**
 * De netwerkkant van de Dirk-koppeling.
 *
 * Niet-officiële endpoints, alleen voor ons eigen huishouden, en alleen om te
 * kunnen zien wat de boodschappenlijst daar zou kosten. Bestellen gebeurt
 * nooit hier — dat blijft bij Picnic.
 *
 * Twee dingen maken dit anders dan Albert Heijn:
 *
 * 1. **Geen bruikbare zoekfunctie.** De zoekpagina van Dirk laadt client-side,
 *    dus daar valt server-side niets uit te lezen. We crawlen daarom
 *    categoriepagina's naar een eigen index en zoeken daar zelf in. Dat is
 *    ook waarom `search()` hieronder tegen die index praat en niet tegen de
 *    site: één keer per dag crawlen is verkeersvriendelijker dan per
 *    ingrediënt een pagina ophalen.
 * 2. **Het is een scrape.** De opmaak van de pagina is niet afgesproken en kan
 *    zonder aankondiging veranderen. Daarom: nul gevonden producten is een
 *    fóút die luid gemeld wordt, geen lege uitslag. Anders lijkt een kapotte
 *    koppeling op een winkel zonder aanbod — en dat maakt die winkel ten
 *    onrechte de goedkoopste.
 */

/**
 * Bewust bij elke aanroep gelezen en niet één keer bij het laden van de
 * module: alleen zo kan een test een nagebouwde site aanwijzen zonder de
 * volgorde van imports te moeten regisseren.
 */
function dirkBaseUrl(): string {
  return process.env.DIRK_BASE_URL ?? "https://www.dirk.nl";
}

/** Pauze tussen twee paginaverzoeken. */
const REQUEST_SPACING_MS = 400;

/** Hoeveel categoriepagina's we per verversing maximaal ophalen. */
const MAX_CATEGORIES = 60;

export class DirkUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirkUnavailableError";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(path: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${dirkBaseUrl()}${path}`, {
      headers: {
        // Eerlijk melden dat dit een gewone browserachtige lezer is; geen
        // poging om iets te omzeilen.
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "nl-NL,nl;q=0.9",
      },
      cache: "no-store",
    });
  } catch (error) {
    throw new DirkUnavailableError(`Geen verbinding met Dirk: ${errorMessage(error)}`);
  }

  if (!response.ok) {
    throw new DirkUnavailableError(`Dirk antwoordde met ${response.status} op ${path}`);
  }
  return response.text();
}

/**
 * De categoriepagina's die we gaan langslopen.
 *
 * Uit de site zelf gelezen: een vaste lijst in de code veroudert stilzwijgend,
 * en dan levert de verversing minder producten op zonder dat iemand het merkt.
 */
export async function fetchDirkCategoryPaths(): Promise<string[]> {
  const html = await fetchPage("/boodschappen");
  const paths = parseDirkCategoryPaths(html);
  if (paths.length === 0) {
    throw new DirkUnavailableError("Geen categorieën gevonden op de overzichtspagina van Dirk");
  }
  return paths.slice(0, MAX_CATEGORIES);
}

export interface DirkCrawlResult {
  products: ProviderProduct[];
  categoriesVisited: number;
  categoriesFailed: string[];
}

/**
 * Loopt de categorieën langs en verzamelt alles wat leesbaar is.
 *
 * Stopt na tien mislukte pagina's op rij: dan is de site onbereikbaar of de
 * opmaak veranderd, en heeft nog vijftig keer proberen geen zin.
 */
export async function crawlDirkCatalogue(
  options?: { maxCategories?: number }
): Promise<DirkCrawlResult> {
  const correlationId = createCorrelationId();
  const paths = (await fetchDirkCategoryPaths()).slice(0, options?.maxCategories ?? MAX_CATEGORIES);

  const byRef = new Map<string, ProviderProduct>();
  const categoriesFailed: string[] = [];
  let consecutiveFailures = 0;
  let categoriesVisited = 0;

  for (const [index, path] of paths.entries()) {
    if (index > 0) await sleep(REQUEST_SPACING_MS);
    try {
      const html = await fetchPage(path);
      categoriesVisited += 1;
      consecutiveFailures = 0;
      for (const product of parseDirkProducts(html)) {
        // Hetzelfde product kan in meerdere categorieën staan; de eerste
        // lezing telt.
        if (!byRef.has(product.externalRef)) byRef.set(product.externalRef, product);
      }
    } catch (error) {
      categoriesFailed.push(`${path}: ${errorMessage(error)}`);
      consecutiveFailures += 1;
      if (consecutiveFailures >= 10) {
        logEvent({
          level: "error",
          area: "pricing",
          message: "Dirk-crawl gestaakt na tien mislukte pagina's op rij",
          correlationId,
          meta: { visited: categoriesVisited, failed: categoriesFailed.length },
        });
        break;
      }
    }
  }

  const products = [...byRef.values()];
  if (products.length === 0) {
    // Luid falen. De vorige prijzen blijven staan — die zijn oud, maar niet
    // verzonnen — en de vergelijking meldt dat Dirk vandaag ontbreekt.
    throw new DirkUnavailableError(
      `Dirk-crawl leverde geen enkel product op (${categoriesVisited} pagina's bezocht, ${categoriesFailed.length} mislukt)`
    );
  }

  logEvent({
    level: categoriesFailed.length > 0 ? "warn" : "info",
    area: "pricing",
    message: "Dirk-crawl afgerond",
    correlationId,
    meta: { categoriesVisited, productsFound: products.length, categoriesFailed: categoriesFailed.length },
  });

  return { products, categoriesVisited, categoriesFailed };
}

/**
 * De eigen index, in het geheugen van één verversing.
 *
 * Bewust geen aparte tabel: wat we ervan bewaren zijn gewoon `Product`-rijen
 * met provider DIRK, precies zoals bij Albert Heijn. Een tweede opslagvorm
 * voor "alles wat Dirk verkoopt" zou onderhoud kosten zonder dat iemand die
 * gegevens ooit ziet.
 */
export function searchDirkIndex(
  catalogue: ProviderProduct[],
  term: string,
  limit = 10
): ProviderProduct[] {
  return rankStoreProducts(term, catalogue, limit).map((match) => match.product);
}

/**
 * De provider-interface voor Dirk.
 *
 * `search()` crawlt bewust niet zelf: dat zou per ingrediënt tientallen
 * pagina's ophalen. De verversing crawlt één keer en zoekt daarna in de
 * opgehaalde catalogus (zie `refreshDirkPrices`).
 */
export const dirkPriceProvider: StorePriceProvider = {
  provider: "DIRK",
  label: "Dirk",
  capabilities: DIRK_CAPABILITIES,
  search: async () => {
    throw new DirkUnavailableError(
      "Dirk heeft geen bruikbare zoekfunctie; de vergelijking gebruikt de gecrawlde catalogus."
    );
  },
};
