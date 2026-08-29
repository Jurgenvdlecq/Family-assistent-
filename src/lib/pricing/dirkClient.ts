import { logEvent, createCorrelationId, errorMessage } from "@/lib/logger";
import {
  DIRK_CAPABILITIES,
  parseDirkCategoryPaths,
  parseDirkProducts,
} from "@/domain/pricing/providers/dirkProvider";
import { rankStoreProducts } from "@/domain/pricing/storeMatch";
import { rankDirkCategories } from "@/domain/pricing/providers/dirkProvider";
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
 * 1. **De zoekfunctie is bruikbaar — maar dat wordt gemeten, niet aangenomen.**
 *    Hier stond lang dat Dirks zoekpagina client-side laadt en er dus niets
 *    uit te lezen valt. Dat kwam uit de oorspronkelijke opdracht en is nooit
 *    getoetst; in de praktijk geeft `/zoeken/producten/<term>` gewoon
 *    leesbare producten. `dirkSearchWorks` stelt het daarom elke verversing
 *    opnieuw vast, en bij nee wordt er alsnog gecrawld. Zo hoeft niemand een
 *    aanname te geloven, en corrigeert de app zichzelf als Dirk haar site
 *    omgooit — in welke richting dan ook.
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

/**
 * Het pad van Dirks zoekpagina.
 *
 * De zoekterm staat in het pad, niet in een queryparameter:
 * `/zoeken/producten/Melk`. Door de gebruiker aangeleverd uit de adresbalk —
 * geraden had hier niets opgeleverd.
 */
export function dirkSearchPath(term: string): string {
  return `/zoeken/producten/${encodeURIComponent(term)}`;
}

/**
 * Een term opzoeken op Dirks eigen zoekpagina.
 *
 * Levert alleen iets op als die pagina server-side gerenderd is. Was dat niet
 * zo, dan komt er een lege huls terug en dus een lege lijst — geen fout: dit
 * is precies de vraag die `dirkSearchWorks` hieronder beantwoordt.
 */
export async function searchDirkPage(term: string): Promise<ProviderProduct[]> {
  return parseDirkProducts(await fetchPage(dirkSearchPath(term)));
}

/**
 * Waarmee we vaststellen of Dirks zoekpagina bruikbaar is.
 *
 * Een gewoon woord dat een Nederlandse supermarkt gegarandeerd voert. Komt
 * daar niets leesbaars uit, dan rendert die pagina client-side (of is de
 * opmaak veranderd) — en in beide gevallen valt er niets uit te lezen en is
 * crawlen de enige weg.
 */
const SEARCH_PROBE_TERM = "melk";

/**
 * Kan Dirks zoekpagina gelezen worden?
 *
 * Bestaat omdat het antwoord nooit gemeten was: de code ging ervan uit dat die
 * pagina client-side laadt, en dat kwam uit de oorspronkelijke opdracht in
 * plaats van uit een proef. Door het één keer per verversing echt te vragen
 * hoeft niemand die aanname te geloven, en corrigeert de app zichzelf als
 * Dirk haar site ooit omgooit — in welke richting dan ook.
 */
export async function dirkSearchWorks(): Promise<boolean> {
  try {
    return (await searchDirkPage(SEARCH_PROBE_TERM)).length > 0;
  } catch {
    // Onbereikbaar of een foutcode: dan weten we het niet, en dan is de
    // beproefde weg (crawlen) de veiligste.
    return false;
  }
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
  options?: {
    maxCategories?: number;
    /**
     * De namen waar deze verversing voor bedoeld is (ingrediënten en de
     * producten die wij daarvoor kopen). Bepaalt wélke categorieën eerst
     * bezocht worden — zonder dit is de volgorde die van Dirks eigen menu, en
     * dat staat volledig los van wat er op de lijst staat.
     */
    relevantTo?: string[];
    /** Wanneer de crawl moet stoppen, ook als er nog categorieën over zijn. */
    deadline?: number;
  }
): Promise<DirkCrawlResult> {
  const correlationId = createCorrelationId();
  // Eerst kiezen wélke categorieën, dan pas afkappen. Andersom (afkappen en
  // dan pas kijken) leverde de eerste zes van de overzichtspagina op, en die
  // hebben niets met de boodschappenlijst te maken.
  const paths = rankDirkCategories(await fetchDirkCategoryPaths(), options?.relevantTo ?? []).slice(
    0,
    options?.maxCategories ?? MAX_CATEGORIES
  );

  const byRef = new Map<string, ProviderProduct>();
  const categoriesFailed: string[] = [];
  let consecutiveFailures = 0;
  let categoriesVisited = 0;

  let stoppedOnTime = false;
  for (const [index, path] of paths.entries()) {
    // De crawl zelf begrenzen, niet alleen het matchen erna. Zonder deze
    // controle kan het ophalen van de pagina's het hele tijdsbudget opeten en
    // komt het matchen er niet eens aan toe.
    if (options?.deadline !== undefined && Date.now() >= options.deadline) {
      stoppedOnTime = true;
      break;
    }
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
    //
    // Wél met de juiste reden: op de klok gestopt is iets heel anders dan een
    // scraper die niets meer leest, en dat verschil bepaalt of er iemand naar
    // de code moet kijken of dat het gewoon een keer druk was.
    throw new DirkUnavailableError(
      stoppedOnTime
        ? "Dirk-crawl gestopt bij het tijdslimiet voordat er iets was opgehaald"
        : `Dirk-crawl leverde geen enkel product op (${categoriesVisited} pagina's bezocht, ${categoriesFailed.length} mislukt)`
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
  // De verversing kiest zelf tussen de zoekpagina en de gecrawlde catalogus
  // (zie `refreshDirkPrices`); deze losse ingang wordt daar niet voor
  // gebruikt en zou alleen maar een derde, afwijkende weg openen.
  search: async () => {
    throw new DirkUnavailableError(
      "Gebruik refreshDirkPrices: die bepaalt zelf of de zoekpagina of de catalogus wordt gebruikt."
    );
  },
};
