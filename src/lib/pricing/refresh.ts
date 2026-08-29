import { prisma } from "@/lib/prisma";
import { logEvent, createCorrelationId, errorMessage } from "@/lib/logger";
import type { ProductProvider } from "@/generated/prisma/enums";
import { rankStoreProducts, storeSearchTerm } from "@/domain/pricing/storeMatch";
import type { StorePriceProvider } from "@/domain/pricing/types";
import { recordObservedProduct } from "./observations";
import { ahPriceProvider, fetchAhProductExtras } from "./ahClient";
import { crawlDirkCatalogue } from "./dirkClient";

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
      OR: [
        { recipeIngredients: { some: {} } },
        { fixedGroceries: { some: {} } },
        ...(onCurrentList ? [onCurrentList] : []),
      ],
    },
    select: {
      id: true,
      name: true,
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

  const ingredients = found.map((ingredient) => ({
    id: ingredient.id,
    name: ingredient.name,
    referenceProductName: ingredient.products[0]?.name ?? null,
    referencePackageSize: ingredient.products[0]?.packageSize ?? null,
  }));

  if (!householdId || !weekStart) return ingredients;

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
    ...ingredients.filter((ingredient) => priority.has(ingredient.id)),
    ...ingredients.filter((ingredient) => !priority.has(ingredient.id)),
  ];
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
      const ownTerm = ingredient.referenceProductName
        ? storeSearchTerm(ingredient.referenceProductName)
        : null;
      const fallbackTerm = storeSearchTerm(ingredient.name);

      let found = await provider.search(ownTerm ?? fallbackTerm, { limit: SEARCH_RESULT_LIMIT });
      let matches = rankStoreProducts(ingredient.name, found, CANDIDATES_PER_INGREDIENT, reference);

      // Terugvallen op de bredere zoekterm zodra de specifieke niets
      // bruikbaars oplevert — niet pas bij nul resultaten. Een winkel geeft
      // zelden helemaal niets terug; ze geeft iets terug dat er niet bij
      // hoort, en dan zou een controle op "leeg" nooit aanslaan en zouden we
      // met lege handen staan terwijl het product er gewoon ligt.
      if (matches.length === 0 && ownTerm !== null && ownTerm !== fallbackTerm) {
        await sleep(REQUEST_SPACING_MS);
        const broader = await provider.search(fallbackTerm, { limit: SEARCH_RESULT_LIMIT });
        found = [...found, ...broader];
        matches = rankStoreProducts(ingredient.name, found, CANDIDATES_PER_INGREDIENT, reference);
      }

      consecutiveFailures = 0;
      result.itemsSeen = (result.itemsSeen ?? 0) + found.length;

      if (matches.length === 0) {
        result.ingredientsWithoutMatch += 1;
        continue;
      }

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

        await recordObservedProduct({
          product,
          ingredientId: ingredient.id,
          source: provider.capabilities.reliability === "api" ? "API" : "SCRAPE",
        });
        result.productsStored += 1;
      }
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
 * Dirk ververst anders dan de rest: eerst crawlen, dan pas matchen.
 *
 * Dirk heeft geen bruikbare zoekfunctie (de zoekpagina laadt client-side), dus
 * per ingrediënt een zoekopdracht doen kan niet. In plaats daarvan wordt de
 * catalogus één keer gecrawld en daarna lokaal doorzocht — dat is meteen
 * verkeersvriendelijker dan honderden losse aanvragen.
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
    })
  ).slice(0, options?.limitIngredients ?? Infinity);
  const result: RefreshResult = {
    provider: "DIRK",
    ingredientsChecked: 0,
    productsStored: 0,
    ingredientsWithoutMatch: 0,
    itemsSeen: null,
    errors: [],
    abortedAfter: null,
  };

  let catalogue;
  try {
    catalogue = await crawlDirkCatalogue({ maxCategories: options?.maxCategories });
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
    const matches = rankStoreProducts(ingredient.name, catalogue.products, CANDIDATES_PER_INGREDIENT, {
      name: ingredient.referenceProductName,
      packageSize: ingredient.referencePackageSize,
    });
    if (matches.length === 0) {
      result.ingredientsWithoutMatch += 1;
      continue;
    }
    for (const match of matches) {
      await recordObservedProduct({
        product: match.product,
        ingredientId: ingredient.id,
        // Dirk is een scrape, en dat blijft zichtbaar tot in de waarneming.
        source: "SCRAPE",
      });
      result.productsStored += 1;
    }
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
