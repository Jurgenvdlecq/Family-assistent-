import { prisma } from "@/lib/prisma";
import { logEvent, createCorrelationId, errorMessage } from "@/lib/logger";
import type { ProductProvider } from "@/generated/prisma/enums";
import { rankStoreProducts } from "@/domain/pricing/storeMatch";
import type { StorePriceProvider } from "@/domain/pricing/types";
import { recordObservedProduct } from "./observations";
import { ahPriceProvider, fetchAhProductExtras } from "./ahClient";

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
const CANDIDATES_PER_INGREDIENT = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * De ingrediënten die het waard zijn om prijzen van bij te houden: alles wat
 * in een recept voorkomt of een vaste boodschap is.
 */
export async function getPricedIngredients() {
  return prisma.ingredient.findMany({
    where: {
      OR: [{ recipeIngredients: { some: {} } }, { fixedGroceries: { some: {} } }],
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export interface RefreshResult {
  provider: ProductProvider;
  ingredientsChecked: number;
  productsStored: number;
  ingredientsWithoutMatch: number;
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
  options?: { limitIngredients?: number; withExtras?: boolean }
): Promise<RefreshResult> {
  const correlationId = createCorrelationId();
  const ingredients = (await getPricedIngredients()).slice(0, options?.limitIngredients ?? Infinity);
  const result: RefreshResult = {
    provider: provider.provider,
    ingredientsChecked: 0,
    productsStored: 0,
    ingredientsWithoutMatch: 0,
    errors: [],
    abortedAfter: null,
  };

  let consecutiveFailures = 0;

  for (const [index, ingredient] of ingredients.entries()) {
    if (index > 0) await sleep(REQUEST_SPACING_MS);
    result.ingredientsChecked += 1;

    try {
      const found = await provider.search(ingredient.name, { limit: 10 });
      consecutiveFailures = 0;

      const matches = rankStoreProducts(ingredient.name, found, CANDIDATES_PER_INGREDIENT);
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

/** Alle winkels die de app zelf kan bevragen. Picnic hoort hier niet bij: dat loopt via de huishoudsessie. */
export function refreshableProviders(): StorePriceProvider[] {
  return [ahPriceProvider];
}

export async function refreshAllStorePrices(): Promise<RefreshResult[]> {
  const results: RefreshResult[] = [];
  for (const provider of refreshableProviders()) {
    results.push(await refreshStorePrices(provider, { withExtras: true }));
  }
  return results;
}
