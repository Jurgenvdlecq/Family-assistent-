import { prisma } from "@/lib/prisma";
import type { ProductProvider } from "@/generated/prisma/enums";
import {
  compareBasket,
  type BasketComparison,
  type BasketLineInput,
  type StoreCandidateInput,
} from "@/domain/pricing/basketComparison";
import { deriveQualityTier } from "@/domain/pricing/qualityTier";
import { getStoreCandidatesForIngredients, type StorePriceForIngredient } from "./storePrices";

/**
 * De brug tussen de boodschappenlijst en de mandje-simulatie.
 *
 * Alles wat hier gebeurt is data verzamelen; het rekenwerk en de
 * equivalentie-afweging zitten in `src/domain/pricing`. Reden voor die knip:
 * de vraag "is houdbare melk een vervanger voor verse melk" is een
 * productbeslissing die met een gewone unittest te bewijzen moet zijn, zonder
 * database.
 *
 * Deze laag leest alleen uit de database. Een winkel bevragen tijdens het
 * laden van een pagina gebeurt nooit — dat doet de geplande verversing.
 */

export interface BasketOverview {
  comparison: BasketComparison;
  /** Handmatige correcties: per ingrediënt per winkel het product dat het huishouden zelf koos. */
  choicesByIngredient: Map<string, Map<ProductProvider, string>>;
  /** Alle kandidaten per ingrediënt, zodat de gebruiker een ander product kan kiezen. */
  candidatesByIngredient: Map<string, StorePriceForIngredient[]>;
  /** De regels zelf, voor de tabel op het scherm. */
  lineMeta: Map<string, { ingredientId: string; picnicProductName: string | null }>;
  /** `null` betekent: er is deze week nog geen lijst om door te rekenen. */
  shoppingListId: string | null;
}

/** De winkels waar we vandaag inzicht in hebben. Picnic is de referentie, geen kolom. */
export const COMPARISON_PROVIDERS: ProductProvider[] = ["AH"];

/**
 * Rekent de huidige boodschappenlijst van een huishouden door.
 *
 * De referentie is bewust het product dat er nú op de regel staat — dat is wat
 * er daadwerkelijk besteld zou worden. Staat er nog geen product op (regel is
 * nog niet gematcht), dan is de regel niet vergelijkbaar en zegt de app dat
 * ook, in plaats van een willekeurig product als "wat jullie normaal kopen" te
 * behandelen.
 */
export async function getBasketOverview(
  householdId: string,
  mealPlanId: string,
  providers: ProductProvider[] = COMPARISON_PROVIDERS,
  now: Date = new Date()
): Promise<BasketOverview> {
  const shoppingList = await prisma.shoppingList.findUnique({
    where: { mealPlanId },
    include: { lines: { include: { ingredient: true, product: true } } },
  });

  const empty: BasketOverview = {
    comparison: compareBasket([], new Map(), providers),
    choicesByIngredient: new Map(),
    candidatesByIngredient: new Map(),
    lineMeta: new Map(),
    shoppingListId: null,
  };
  if (!shoppingList || shoppingList.lines.length === 0) return empty;

  // Regels die je zelf haalt gaan sowieso niet via een winkelbestelling; ze
  // horen dus ook niet in een winkeltotaal thuis. Ze verdwijnen niet uit
  // beeld, ze tellen alleen niet mee — de pagina zegt dat er ook bij.
  const lines = shoppingList.lines.filter((line) => line.fulfillment === "PICNIC");
  if (lines.length === 0) return { ...empty, shoppingListId: shoppingList.id };

  const ingredientIds = [...new Set(lines.map((line) => line.ingredientId))];

  const [candidatesByIngredient, choices] = await Promise.all([
    getStoreCandidatesForIngredients(ingredientIds, providers, 6, now),
    prisma.householdStoreProductChoice.findMany({
      where: { householdId, ingredientId: { in: ingredientIds }, provider: { in: providers } },
    }),
  ]);

  const choicesByIngredient = new Map<string, Map<ProductProvider, string>>();
  for (const choice of choices) {
    const perProvider = choicesByIngredient.get(choice.ingredientId) ?? new Map<ProductProvider, string>();
    perProvider.set(choice.provider, choice.productId);
    choicesByIngredient.set(choice.ingredientId, perProvider);
  }

  const basketLines: BasketLineInput[] = [];
  const candidatesByLine = new Map<string, StoreCandidateInput[]>();
  const lineMeta = new Map<string, { ingredientId: string; picnicProductName: string | null }>();

  for (const line of lines) {
    basketLines.push({
      lineId: line.id,
      ingredientId: line.ingredientId,
      ingredientName: line.ingredient.name,
      neededQuantity: line.quantity,
      unit: line.unit,
      reference: line.product
        ? {
            name: line.product.name,
            brand: line.product.brand,
            packageSize: line.product.packageSize,
            // De klasse staat alleen opgeslagen bij producten die uit een
            // prijsverversing komen; Picnic-producten zijn er nooit langs
            // geweest. Zonder deze afleiding zou élke regel "niet te
            // vergelijken" heten, puur omdat het veld leeg is. Zonder merk
            // blijft het antwoord `null`, en dan is "niet vergelijkbaar" ook
            // het eerlijke antwoord.
            qualityTier:
              line.product.qualityTier ??
              deriveQualityTier({
                provider: line.product.provider,
                name: line.product.name,
                brand: line.product.brand,
              }),
            gtin: line.product.gtin,
            price: line.product.price === null ? null : Number(line.product.price),
            packageQuantity: line.product.packageQuantity,
          }
        : null,
    });
    lineMeta.set(line.id, {
      ingredientId: line.ingredientId,
      picnicProductName: line.product?.name ?? null,
    });

    const all = candidatesByIngredient.get(line.ingredientId) ?? [];
    const chosen = choicesByIngredient.get(line.ingredientId);
    // Een handmatige correctie is geen suggestie maar een beslissing: is er
    // voor deze winkel een product gekozen, dan rekent de app daarmee en niet
    // met wat de matcher zelf mooier vindt.
    const effective = all.filter((candidate) => {
      const pinned = chosen?.get(candidate.provider);
      return pinned ? candidate.productId === pinned : true;
    });
    candidatesByLine.set(line.id, effective.map(toStoreCandidate));
  }

  return {
    comparison: compareBasket(basketLines, candidatesByLine, providers),
    choicesByIngredient,
    candidatesByIngredient,
    lineMeta,
    shoppingListId: shoppingList.id,
  };
}

function toStoreCandidate(candidate: StorePriceForIngredient): StoreCandidateInput {
  return {
    provider: candidate.provider,
    productId: candidate.productId,
    name: candidate.name,
    brand: candidate.brand,
    packageSize: candidate.packageSize,
    packageQuantity: candidate.packageQuantity,
    qualityTier: candidate.qualityTier,
    gtin: candidate.gtin,
    price: candidate.price,
    promoLabel: candidate.promoLabel,
    observedAt: candidate.observedAt,
    stale: candidate.stale,
  };
}
