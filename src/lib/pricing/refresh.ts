import { prisma } from "@/lib/prisma";
import { logEvent, createCorrelationId, errorMessage } from "@/lib/logger";
import type { ProductProvider } from "@/generated/prisma/enums";
import { rankStoreProducts, storeSearchTerm } from "@/domain/pricing/storeMatch";
import type { ProviderProduct, StorePriceProvider } from "@/domain/pricing/types";
import { recordObservedProducts } from "./observations";
import { ahPriceProvider, fetchAhProductExtras } from "./ahClient";
import { crawlDirkCatalogue, dirkSearchWorks, searchDirkPage } from "./dirkClient";

/**
 * De dagelijkse prijsverversing.
 *
 * Drie regels die het verkeer beperken en tegelijk de vergelijking bruikbaar
 * houden (zie "Risico's" in de opdracht):
 *
 * 1. Alleen ingrediënten die in ons eigen receptenboek of in de vaste
 *    boodschappen voorkomen. Het hele assortiment ophalen zou én veel verkeer
 *    zijn én niets toevoegen: wat we nooit kopen hoeft geen prijs te hebben.
 * 2. Eén keer per dag, gespreid, met een pauze tussen de aanroepen.
 * 3. Nul gevonden producten is een fóút, geen lege uitslag — anders lijkt een
 *    kapotte koppeling op een winkel zonder aanbod, en dat maakt die winkel
 *    ten onrechte de goedkoopste.
 */

/** Pauze tussen twee zoekopdrachten, zodat we de winkel niet overvragen. */
const REQUEST_SPACING_MS = 350;

/** Hoeveel kandidaten per ingrediënt bewaard worden voor de vergelijking. */
// Ruimer dan de drie van vroeger. Drie was te krap zodra een winkel meerdere
// varianten van hetzelfde merk voert: het juiste product viel dan buiten de
// boot en niets verderop kon dat nog goedmaken — afwaarderen kan alleen wat
// er ligt.
const CANDIDATES_PER_INGREDIENT = 8;

// Hoeveel zoekresultaten we van een winkel bekijken. Tien was krap: bij een
// breed begrip als "appelmoes" staan de cupjes makkelijk op plek twaalf, en
// wat we niet zien kunnen we ook niet kiezen.
const SEARCH_RESULT_LIMIT = 20;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waarop we bij de winkels zoeken voor dit ingrediënt.
 *
 * Volgorde: een zelf ingetypte zoekterm wint van alles. Wie die invult heeft
 * gezien dát de app het zelf niet redde — bij "Snack Tomaatjes" tegenover
 * "snoeptomaatjes" is er geen woord gemeen en komt geen enkele vuistregel
 * daar overheen. Staat er niets, dan zoeken we op het product dat we
 * werkelijk kopen, en anders op de ingrediëntnaam.
 *
 * Ook een ingetypte term gaat door `storeSearchTerm`: getallen en
 * verpakkingsmaten leveren bij een winkel niets op, of iemand ze nu zelf
 * intikt of niet.
 */
function searchTermFor(ingredient: PricedIngredient): string | null {
  const typed = ingredient.searchTerm?.trim();
  if (typed) return storeSearchTerm(typed);
  return ingredient.referenceProductName ? storeSearchTerm(ingredient.referenceProductName) : null;
}

/**
 * Vastleggen dat een zelf ingetypte zoekterm niets bruikbaars opleverde.
 *
 * Alleen voor een term die iemand écht heeft ingetypt: valt de app terug op
 * haar eigen zoekwoord, dan is dat huishoudelijk werk waar niemand iets van
 * hoeft te weten. Maar wie een term intikt heeft een verwachting, en die
 * verdient antwoord — ook als het antwoord "die term leverde hier niets op" is.
 */
function noteUnusedSearchTerm(ingredient: PricedIngredient, result: RefreshResult): void {
  const typed = ingredient.searchTerm?.trim();
  if (typed) result.unusedSearchTerms.push(`${ingredient.name}: "${typed}"`);
}

/**
 * Waarop we de gevonden producten beoordelen.
 *
 * Dit moet meebewegen met `searchTermFor`, en dat is niet vanzelfsprekend:
 * eerst ging de ingetypte term alleen naar de winkel toe en werd er daarna
 * alsnog op de ingrediëntnaam gematcht. "Snoeptomaatjes" werd dus keurig
 * opgehaald en vervolgens weggegooid, want met "Snack Tomaatjes" heeft die
 * naam geen woord gemeen — precies het geval waarvoor dit veld bestaat. Een
 * knop die niets doet is erger dan geen knop.
 *
 * Wie de term intypt zegt daarmee: dít is hetzelfde product. Dat oordeel
 * hoort zwaarder te wegen dan onze vuistregels.
 */
function matchNameFor(ingredient: PricedIngredient): string {
  return ingredient.searchTerm?.trim() || ingredient.name;
}

/**
 * De ingrediënten die het waard zijn om prijzen van bij te houden: alles wat
 * in een recept voorkomt of een vaste boodschap is.
 */
export interface PricedIngredientOptions {
  /** Zet de ingrediënten van de boodschappenlijst van dit huishouden vooraan. */
  prioritiseHouseholdId?: string;
  /**
   * Van wélke week. Verplicht bij prioriteren: zonder deze afbakening zouden
   * alle weeklijsten ooit meetellen, en dan verdringt de geschiedenis binnen
   * die groep alsnog alfabetisch de lijst van nu — precies de fout die het
   * prioriteren moest oplossen.
   */
  weekStart?: Date;
  /**
   * Zet binnen elke groep de ingrediënten vooraan die voor deze winkel het
   * langst niet ververst zijn.
   *
   * Zonder dit begint elke verversing weer bij hetzelfde ingrediënt, en komt
   * de staart van de lijst er structureel nooit aan — hoe vaak je ook op de
   * knop drukt, want een verversing die op het tijdslimiet stopt heeft altijd
   * de eerste ingrediënten gedaan. Met deze volgorde dekken een paar rondes
   * samen wél de hele lijst, zonder dat er ergens een teller bewaard hoeft te
   * worden: wanneer iets voor het laatst is bijgewerkt weten we al.
   */
  staleFirstFor?: ProductProvider;
  /**
   * Alleen dit ene ingrediënt.
   *
   * Voor de knop "opslaan" bij een zelf ingetypte zoekterm: die haalt meteen
   * op wat die term oplevert, zodat je niet eerst iets opslaat, dan een tweede
   * knop moet vinden en pas daarna ziet of het werkte. Eén regel is snel
   * genoeg om op te wachten; de hele lijst niet.
   */
  onlyIngredientId?: string;
}

/**
 * Een ingrediënt zoals de verversing het nodig heeft: de naam waaronder wij
 * het kennen, plus het Picnic-product dat we er werkelijk voor kopen. Dat
 * laatste bepaalt waarmee er bij de winkels gezocht wordt.
 */
export interface PricedIngredient {
  id: string;
  name: string;
  referenceProductName: string | null;
  referencePackageSize: string | null;
  /**
   * Een zelf ingetypte zoekterm, als die er is.
   *
   * Gaat vóór alles: wie 'm invult heeft gezien dat de app het zelf niet
   * redde, en dan is dat oordeel meer waard dan onze vuistregels.
   */
  searchTerm: string | null;
}

export async function getPricedIngredients(options?: PricedIngredientOptions) {
  const householdId = options?.prioritiseHouseholdId;
  const weekStart = options?.weekStart;

  // Regels die de gebruiker zelf heeft toegevoegd (handmatig, of uit de
  // voorraadcontrole) zitten soms in geen enkel recept en zijn geen vaste
  // boodschap. Zonder deze derde tak zouden ze nooit een prijs krijgen, en
  // prioriteren kan daar per definitie niets aan veranderen.
  const onCurrentList =
    householdId && weekStart
      ? { shoppingListLines: { some: { shoppingList: { mealPlan: { householdId, weekStart } } } } }
      : null;

  const found = await prisma.ingredient.findMany({
    where: {
      ...(options?.onlyIngredientId ? { id: options.onlyIngredientId } : {}),
      OR: [
        { recipeIngredients: { some: {} } },
        { fixedGroceries: { some: {} } },
        ...(onCurrentList ? [onCurrentList] : []),
      ],
    },
    select: {
      id: true,
      name: true,
      // Zelf ingetypt, en dan gaat het voor al het onderstaande.
      searchTerm: true,
      // Het Picnic-product dat we hier werkelijk voor kopen. Dat is waarmee we
      // bij de andere winkels gaan zoeken: de ingrediëntnaam is soms alleen
      // een merk ("Alpro"), en daar vindt een winkel van alles bij behalve het
      // juiste. Het meest recent geziene product is de beste beschikbare
      // benadering van "wat kopen we nu".
      products: {
        where: { provider: "PICNIC" },
        select: { name: true, packageSize: true },
        orderBy: { lastSeenAvailable: { sort: "desc", nulls: "last" } },
        take: 1,
      },
    },
    orderBy: { name: "asc" },
  });

  const ingredients: PricedIngredient[] = found.map((ingredient) => ({
    id: ingredient.id,
    name: ingredient.name,
    referenceProductName: ingredient.products[0]?.name ?? null,
    referencePackageSize: ingredient.products[0]?.packageSize ?? null,
    searchTerm: ingredient.searchTerm?.trim() || null,
  }));

  const ordered = options?.staleFirstFor
    ? await stalestFirst(ingredients, options.staleFirstFor)
    : ingredients;

  if (!householdId || !weekStart) return ordered;

  // Bij een verversing die maar een deel van de lijst pakt (de knop "nu
  // verversen") moet dát deel wél gaan over wat de gebruiker op dit moment
  // voor zich heeft. Alfabetisch de eerste vijftien pakken leverde in de
  // praktijk één prijs op vijftien regels op.
  const onTheList = await prisma.shoppingListLine.findMany({
    where: { shoppingList: { mealPlan: { householdId, weekStart } } },
    select: { ingredientId: true },
    distinct: ["ingredientId"],
  });
  const priority = new Set(onTheList.map((line) => line.ingredientId));

  return [
    ...ordered.filter((ingredient) => priority.has(ingredient.id)),
    ...ordered.filter((ingredient) => !priority.has(ingredient.id)),
  ];
}

/**
 * Het langst niet bijgewerkte ingrediënt eerst, voor deze winkel.
 *
 * `lastSeenAvailable` wordt bij elke waarneming bijgewerkt, dus dat veld ís al
 * de teller die we nodig hebben — een eigen "waar was ik gebleven"-kolom zou
 * hetzelfde nog eens opslaan en kan achterlopen zodra er iets misgaat. Wat nog
 * nooit is opgehaald staat vooraan: dat is per definitie het langst geleden.
 */
async function stalestFirst(
  ingredients: PricedIngredient[],
  provider: ProductProvider
): Promise<PricedIngredient[]> {
  const seen = await prisma.product.groupBy({
    by: ["ingredientId"],
    where: { provider, ingredientId: { in: ingredients.map((ingredient) => ingredient.id) } },
    _max: { lastSeenAvailable: true },
  });
  const lastSeen = new Map(
    seen.map((row) => [row.ingredientId, row._max.lastSeenAvailable?.getTime() ?? 0])
  );

  return [...ingredients].sort(
    (a, b) => (lastSeen.get(a.id) ?? 0) - (lastSeen.get(b.id) ?? 0)
  );
}

/**
 * De melding bij een verversing die op de klok is gestopt.
 *
 * Bewust in dezelfde lijst als de echte fouten: het is geen storing, maar het
 * is wél "niet alles is gelukt", en dat hoort de gebruiker te lezen in plaats
 * van te moeten afleiden uit een aantal dat lager is dan verwacht.
 */
const STOPPED_ON_TIME = "gestopt bij het tijdslimiet; de rest volgt bij de volgende verversing";

/** Is de tijd op? Zonder afgesproken eindtijd nooit. */
function outOfTime(deadline: number | undefined): boolean {
  return deadline !== undefined && Date.now() >= deadline;
}

export interface RefreshResult {
  provider: ProductProvider;
  ingredientsChecked: number;
  productsStored: number;
  ingredientsWithoutMatch: number;
  /**
   * Hoeveel producten de winkel überhaupt opleverde, vóór het matchen.
   *
   * Nodig om twee heel verschillende situaties uit elkaar te houden die er op
   * het scherm anders hetzelfde uitzien: "de koppeling werkt niet" en "de
   * koppeling werkt, maar niets van dit aanbod past bij jullie ingrediënten".
   *
   * `null` betekent onbekend — dat is iets anders dan nul, en het scherm zegt
   * dan ook niets over de oorzaak.
   */
  itemsSeen: number | null;
  errors: string[];
  /**
   * Zoekopdrachten die de winkel niet beantwoordde, per ingrediënt.
   *
   * Bewust géén `errors`. Een winkel antwoordt op een zoekterm zonder treffers
   * geregeld met een foutcode in plaats van een lege lijst, dus dit is geen
   * storing en mag de verversing niet staken. Maar het is ook nadrukkelijk
   * geen *uitslag*: tot nu toe werd zo'n foutcode stilzwijgend een lege lijst,
   * en een lege lijst werd op het scherm "niet gevonden". Daarmee was er geen
   * enkel verschil te zien tussen "deze winkel verkoopt dit niet" en "de vraag
   * is nooit aangekomen" — precies het onderscheid dat je nodig hebt om te
   * weten of er iemand naar de code moet kijken.
   */
  searchFailures: string[];
  /**
   * Zelf ingetypte zoektermen die niets bruikbaars opleverden.
   *
   * De verversing valt dan terug op haar eigen zoekwoord, en dat is het juiste
   * gedrag — een matige uitslag is beter dan een lege. Maar op het scherm zag
   * je daar niets van: je had "beschuit naturel" ingetypt, kreeg daarna nog
   * steeds de vezelrijke variant te zien, en kon alleen maar raden of de app
   * je term genegeerd had of dat de winkel 'm niet kende.
   */
  unusedSearchTerms: string[];
  /** Bij een storing: hoeveel ingrediënten er niet meer geprobeerd zijn. */
  abortedAfter: number | null;
}

/**
 * Ververst de prijzen van één winkel.
 *
 * Stopt bij aanhoudende fouten in plaats van honderden mislukkende aanroepen
 * te doen: als de eerste tien queries falen is de koppeling stuk, niet het
 * assortiment.
 */
export async function refreshStorePrices(
  provider: StorePriceProvider,
  options?: { limitIngredients?: number; withExtras?: boolean; deadline?: number } & PricedIngredientOptions
): Promise<RefreshResult> {
  const correlationId = createCorrelationId();
  const ingredients = (
    await getPricedIngredients({
      prioritiseHouseholdId: options?.prioritiseHouseholdId,
      weekStart: options?.weekStart,
      staleFirstFor: provider.provider,
      onlyIngredientId: options?.onlyIngredientId,
    })
  ).slice(0, options?.limitIngredients ?? Infinity);
  const result: RefreshResult = {
    provider: provider.provider,
    ingredientsChecked: 0,
    productsStored: 0,
    ingredientsWithoutMatch: 0,
    // Nog niet gemeten: pas als er echt gezocht is weten we hoeveel de winkel
    // teruggaf. Zonder dat onderscheid zou een mislukte verversing als
    // "helemaal niets teruggekregen" gelezen worden.
    itemsSeen: null,
    errors: [],
    searchFailures: [],
    unusedSearchTerms: [],
    abortedAfter: null,
  };

  let consecutiveFailures = 0;

  for (const [index, ingredient] of ingredients.entries()) {
    // Netjes stoppen vóór de hostingpartij de aanroep afkapt. Wordt dat aan
    // haar overgelaten, dan krijgt de gebruiker helemaal geen antwoord: de
    // knop blijft op "bezig met ophalen" staan en wat er wél is opgehaald
    // wordt nooit gemeld. Liever de helft doen en dat eerlijk zeggen.
    if (outOfTime(options?.deadline)) {
      result.abortedAfter = index;
      result.errors.push(STOPPED_ON_TIME);
      break;
    }
    if (index > 0) await sleep(REQUEST_SPACING_MS);
    result.ingredientsChecked += 1;

    try {
      // Zoeken op wat we werkelijk kopen, niet op de ingrediëntnaam. Levert
      // dat niets op — de winkel voert dat product simpelweg niet — dan
      // alsnog op het ingrediënt, want een lege uitslag is erger dan een
      // ruwere. Alleen bij nul resultaten, zodat dit geen verdubbeling van
      // het verkeer wordt.
      const reference = {
        name: ingredient.referenceProductName,
        packageSize: ingredient.referencePackageSize,
      };
      const ownTerm = searchTermFor(ingredient);
      const fallbackTerm = storeSearchTerm(ingredient.name);

      let found = await provider.search(ownTerm ?? fallbackTerm, { limit: SEARCH_RESULT_LIMIT });
      let matches = rankStoreProducts(matchNameFor(ingredient), found, CANDIDATES_PER_INGREDIENT, reference);

      // Terugvallen op de bredere zoekterm zodra de specifieke niets
      // bruikbaars oplevert — niet pas bij nul resultaten. Een winkel geeft
      // zelden helemaal niets terug; ze geeft iets terug dat er niet bij
      // hoort, en dan zou een controle op "leeg" nooit aanslaan en zouden we
      // met lege handen staan terwijl het product er gewoon ligt.
      if (matches.length === 0 && ownTerm !== null && ownTerm !== fallbackTerm) {
        noteUnusedSearchTerm(ingredient, result);
        await sleep(REQUEST_SPACING_MS);
        const broader = await provider.search(fallbackTerm, { limit: SEARCH_RESULT_LIMIT });
        found = [...found, ...broader];
        matches = rankStoreProducts(matchNameFor(ingredient), found, CANDIDATES_PER_INGREDIENT, reference);
      }

      consecutiveFailures = 0;
      result.itemsSeen = (result.itemsSeen ?? 0) + found.length;

      if (matches.length === 0) {
        result.ingredientsWithoutMatch += 1;
        continue;
      }

      const enriched: ProviderProduct[] = [];
      for (const match of matches) {
        let product = match.product;
        // De barcode en de allergeeninformatie staan alleen op het
        // detailscherm. Alleen ophalen voor de beste kandidaat: het is een
        // extra aanroep per product, en voor de nummers twee en drie voegt
        // het niets toe zolang die niet gekozen worden.
        if (options?.withExtras && provider.capabilities.hasEan && match === matches[0]) {
          try {
            const extras = await fetchAhProductExtras(product.externalRef);
            product = {
              ...product,
              gtin: extras.gtin,
              labels: [...product.labels, ...extras.labels],
              freeFromAllergens: extras.freeFromAllergens,
            };
          } catch (error) {
            // Geen barcode is jammer, geen reden om de prijs weg te gooien.
            logEvent({
              level: "warn",
              area: "pricing",
              message: "Productdetails ophalen mislukt",
              correlationId,
              meta: { provider: provider.provider, externalRef: product.externalRef, error: errorMessage(error) },
            });
          }
        }

        enriched.push(product);
      }

      // Alles van dit ingrediënt in één keer wegschrijven. Per product apart
      // waren dit twee database-aanroepen achter elkaar, en dat liep bij acht
      // kandidaten zo hoog op dat de verversing haar tijdslimiet haalde
      // voordat ze de halve lijst had gehad.
      await recordObservedProducts({
        products: enriched,
        ingredientId: ingredient.id,
        source: provider.capabilities.reliability === "api" ? "API" : "SCRAPE",
      });
      result.productsStored += enriched.length;
    } catch (error) {
      consecutiveFailures += 1;
      result.errors.push(`${ingredient.name}: ${errorMessage(error)}`);
      if (consecutiveFailures >= 10) {
        result.abortedAfter = index + 1;
        logEvent({
          level: "error",
          area: "pricing",
          message: "Prijsverversing gestaakt na tien fouten op rij",
          correlationId,
          meta: { provider: provider.provider, checked: result.ingredientsChecked },
        });
        break;
      }
    }
  }

  // Nul producten is een storing, geen uitslag. Luid melden, en de vorige
  // prijzen laten staan — die zijn oud maar niet verzonnen.
  const failed = result.productsStored === 0 && result.ingredientsChecked > 0;
  logEvent({
    level: failed ? "error" : result.errors.length > 0 ? "warn" : "info",
    area: "pricing",
    message: failed ? "Prijsverversing leverde niets op" : "Prijsverversing afgerond",
    correlationId,
    meta: {
      provider: provider.provider,
      ingredientsChecked: result.ingredientsChecked,
      productsStored: result.productsStored,
      withoutMatch: result.ingredientsWithoutMatch,
      errors: result.errors.length,
      abortedAfter: result.abortedAfter,
    },
  });

  return result;
}

/** Alle winkels die de app per ingrediënt kan bevragen. Picnic hoort hier niet bij: dat loopt via de huishoudsessie. */
export function refreshableProviders(): StorePriceProvider[] {
  return [ahPriceProvider];
}

/**
 * Dirk ververst via haar eigen zoekpagina: één zoekopdracht per ingrediënt.
 *
 * Precies de vorm die Albert Heijn ook heeft, en veel trefzekerder dan
 * crawlen — er valt niets meer te gokken over in welke categorie iets ligt.
 * Wordt alleen gebruikt als `dirkSearchWorks` net heeft vastgesteld dat die
 * pagina server-side leesbaar is.
 */
/**
 * Eén zoekopdracht bij Dirk, waarbij een fout wordt vastgelegd in plaats van
 * weggegooid.
 *
 * Levert bij een fout een lege lijst op — de verversing gaat gewoon door met
 * het volgende ingrediënt — maar noteert wél wát er misging en bij welk
 * ingrediënt, zodat het scherm "de vraag kwam niet aan" kan onderscheiden van
 * "deze winkel voert dit niet".
 */
async function searchWithoutFailing(
  term: string,
  ingredientName: string,
  result: RefreshResult
): Promise<ProviderProduct[]> {
  try {
    return await searchDirkPage(term);
  } catch (error) {
    result.searchFailures.push(`${ingredientName}: ${errorMessage(error)}`);
    return [];
  }
}

async function refreshDirkViaSearch(
  ingredients: PricedIngredient[],
  result: RefreshResult,
  correlationId: string,
  deadline: number | undefined
): Promise<RefreshResult> {
  result.itemsSeen = 0;

  for (const [index, ingredient] of ingredients.entries()) {
    if (outOfTime(deadline)) {
      result.abortedAfter = index;
      result.errors.push(STOPPED_ON_TIME);
      break;
    }
    if (index > 0) await sleep(REQUEST_SPACING_MS);
    result.ingredientsChecked += 1;

    const reference = {
      name: ingredient.referenceProductName,
      packageSize: ingredient.referencePackageSize,
    };
    const ownTerm = searchTermFor(ingredient);
    const fallbackTerm = storeSearchTerm(ingredient.name);

    // Waar de teller stond vóór dit ingrediënt, zodat we straks weten of het
    // aan de zoekopdracht lag of aan het aanbod.
    const failuresBefore = result.searchFailures.length;

    try {
      // Een mislukte zoekopdracht staakt de verversing niet: winkels
      // antwoorden op een zoekterm zonder treffers geregeld met een foutcode
      // in plaats van een lege lijst, en dan is doorgaan het juiste gedrag.
      //
      // Maar hij verdwijnt ook niet meer. Hier stond `.catch(() => [])`, en
      // daarmee werd een foutcode een lege lijst en een lege lijst op het
      // scherm "niet gevonden" — niet te onderscheiden van een winkel die dit
      // product simpelweg niet voert. Precies het verschil dat bepaalt of er
      // iemand naar de code moet kijken.
      let found = await searchWithoutFailing(ownTerm ?? fallbackTerm, ingredient.name, result);
      let matches = rankStoreProducts(matchNameFor(ingredient), found, CANDIDATES_PER_INGREDIENT, reference);

      // Zelfde terugval als bij Albert Heijn: pas breder zoeken als de
      // specifieke zoekopdracht niets bruikbaars oplevert.
      if (matches.length === 0 && ownTerm !== null && ownTerm !== fallbackTerm) {
        noteUnusedSearchTerm(ingredient, result);
        await sleep(REQUEST_SPACING_MS);
        const broader = await searchWithoutFailing(fallbackTerm, ingredient.name, result);
        found = [...found, ...broader];
        matches = rankStoreProducts(matchNameFor(ingredient), found, CANDIDATES_PER_INGREDIENT, reference);
      }

      result.itemsSeen += found.length;
      if (matches.length === 0) {
        // "Geen match" betekent: we hébben aanbod gezien en er zat niets bij.
        // Kwam er niet eens antwoord, dan is dat iets anders, en die twee bij
        // elkaar optellen maakt het getal onbruikbaar voor precies de vraag
        // waarvoor het bestaat.
        if (result.searchFailures.length === failuresBefore) {
          result.ingredientsWithoutMatch += 1;
        }
        continue;
      }
      await recordObservedProducts({
        products: matches.map((match) => match.product),
        ingredientId: ingredient.id,
        source: "SCRAPE",
      });
      result.productsStored += matches.length;
    } catch (error) {
      result.errors.push(`${ingredient.name}: ${errorMessage(error)}`);
    }
  }

  logEvent({
    level: result.errors.length > 0 || result.searchFailures.length > 0 ? "warn" : "info",
    area: "pricing",
    message: "Dirk-verversing via zoekpagina afgerond",
    correlationId,
    meta: {
      ingredientsChecked: result.ingredientsChecked,
      productsStored: result.productsStored,
      withoutMatch: result.ingredientsWithoutMatch,
      searchesFailed: result.searchFailures.length,
      firstSearchFailure: result.searchFailures[0] ?? null,
      errors: result.errors.length,
    },
  });
  return result;
}

/**
 * Dirk ververst anders dan de rest: eerst crawlen, dan pas matchen.
 *
 * Er zijn twee wegen, en welke het wordt stelt de verversing zelf vast. Werkt
 * Dirks zoekpagina, dan gaat het per ingrediënt, net als bij Albert Heijn.
 * Werkt ze niet, dan wordt de catalogus gecrawld en lokaal doorzocht. Die
 * tweede weg was jarenlang de enige, op grond van een aanname over die
 * zoekpagina die nooit gemeten was.
 *
 * Alleen wat bij een van ónze ingrediënten past wordt bewaard. De rest van het
 * assortiment opslaan zou de database vullen met producten die niemand ooit
 * ziet.
 */
export async function refreshDirkPrices(
  options?: { limitIngredients?: number; maxCategories?: number; deadline?: number } & PricedIngredientOptions
): Promise<RefreshResult> {
  const correlationId = createCorrelationId();
  const ingredients = (
    await getPricedIngredients({
      prioritiseHouseholdId: options?.prioritiseHouseholdId,
      weekStart: options?.weekStart,
      staleFirstFor: "DIRK",
      onlyIngredientId: options?.onlyIngredientId,
    })
  ).slice(0, options?.limitIngredients ?? Infinity);
  const result: RefreshResult = {
    provider: "DIRK",
    ingredientsChecked: 0,
    productsStored: 0,
    ingredientsWithoutMatch: 0,
    itemsSeen: null,
    errors: [],
    searchFailures: [],
    unusedSearchTerms: [],
    abortedAfter: null,
  };

  // Eerst één keer vragen of Dirks eigen zoekpagina leesbaar is. Zo ja, dan
  // zoeken we per ingrediënt — net als bij Albert Heijn, en dan verdwijnt het
  // gokwerk over wélke categorie je moet bezoeken. Zo nee, dan crawlen we zoals
  // hiervoor. De aanname dat die pagina onleesbaar is stond jarenlang in de
  // code zonder ooit gemeten te zijn; nu wordt ze elke verversing getoetst.
  if (await dirkSearchWorks()) {
    return refreshDirkViaSearch(ingredients, result, correlationId, options?.deadline);
  }

  let catalogue;
  try {
    catalogue = await crawlDirkCatalogue({
      maxCategories: options?.maxCategories,
      deadline: options?.deadline,
      // Waar deze verversing voor bedoeld is. Zonder dit bezoekt de crawler
      // de eerste categorieën van Dirks eigen menu, en die staan volledig los
      // van wat er op de lijst staat — vandaar "wel aanbod, maar niets dat
      // paste" terwijl sommige producten identiek zijn.
      //
      // Een zelf ingetypte zoekterm hoort hier net zo goed bij: die staat er
      // juist omdát de eigen namen niet werkten, dus zonder hem kiest de
      // crawler de categorieën op precies de woorden waarvan we al weten dat
      // ze niets opleveren.
      relevantTo: ingredients.flatMap((ingredient) =>
        [ingredient.name, ingredient.referenceProductName, ingredient.searchTerm].filter(
          (name): name is string => Boolean(name)
        )
      ),
    });
  } catch (error) {
    // Een mislukte crawl is een storing, geen lege winkel. Luid melden en
    // stoppen; de eerder opgeslagen prijzen blijven staan.
    result.errors.push(errorMessage(error));
    logEvent({
      level: "error",
      area: "pricing",
      message: "Dirk-verversing mislukt",
      correlationId,
      meta: { error: errorMessage(error) },
    });
    return result;
  }

  // Hoeveel de site opleverde: zonder dit getal is "geen passend product" niet
  // te onderscheiden van "de scraper leest niets meer".
  result.itemsSeen = catalogue.products.length;

  for (const [index, ingredient] of ingredients.entries()) {
    if (outOfTime(options?.deadline)) {
      result.abortedAfter = index;
      result.errors.push(STOPPED_ON_TIME);
      break;
    }
    result.ingredientsChecked += 1;
    const matches = rankStoreProducts(
      matchNameFor(ingredient),
      catalogue.products,
      CANDIDATES_PER_INGREDIENT,
      { name: ingredient.referenceProductName, packageSize: ingredient.referencePackageSize }
    );
    if (matches.length === 0) {
      result.ingredientsWithoutMatch += 1;
      continue;
    }
    await recordObservedProducts({
      products: matches.map((match) => match.product),
      ingredientId: ingredient.id,
      // Dirk is een scrape, en dat blijft zichtbaar tot in de waarneming.
      source: "SCRAPE",
    });
    result.productsStored += matches.length;
  }

  const failed = result.productsStored === 0 && result.ingredientsChecked > 0;
  logEvent({
    level: failed ? "error" : "info",
    area: "pricing",
    message: failed ? "Dirk-verversing leverde niets op" : "Dirk-verversing afgerond",
    correlationId,
    meta: {
      ingredientsChecked: result.ingredientsChecked,
      productsStored: result.productsStored,
      withoutMatch: result.ingredientsWithoutMatch,
      catalogueSize: catalogue.products.length,
      categoriesVisited: catalogue.categoriesVisited,
      categoriesFailed: catalogue.categoriesFailed.length,
    },
  });

  return result;
}

export async function refreshAllStorePrices(options?: { deadline?: number }): Promise<RefreshResult[]> {
  const results: RefreshResult[] = [];
  // Elke winkel krijgt een gelijk deel van de resterende tijd. Zonder deze
  // verdeling zou de eerste winkel het hele budget kunnen opsouperen en zou
  // de tweede er structureel niet aan toe komen — precies het soort stille
  // scheefgroei dat je pas maanden later ontdekt.
  const providers = refreshableProviders();
  const shares = providers.length + 1;
  const budget = options?.deadline ? Math.floor((options.deadline - Date.now()) / shares) : null;
  const deadlineFor = () => (budget === null ? undefined : Date.now() + budget);

  for (const provider of providers) {
    results.push(await refreshStorePrices(provider, { withExtras: true, deadline: deadlineFor() }));
  }
  // Dirk apart, omdat de vorm van die verversing anders is. Een mislukte
  // Dirk-crawl mag de AH-prijzen niet meeslepen: die zijn gewoon opgehaald.
  results.push(await refreshDirkPrices({ deadline: deadlineFor() }));
  return results;
}
