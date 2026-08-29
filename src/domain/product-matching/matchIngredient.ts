import { prisma } from "@/lib/prisma";
import { matchProduct } from "./matchProduct";
import { getHouseholdProductChoicePreference } from "./productChoicePreference";
import { getRejectedProductIds, getTrustedPreferences, toMatchCandidate } from "./repository";
import type { ProductMatchResult } from "./types";

/**
 * Matcht één ingrediënt tegen zijn kandidaat-producten. Voor plekken die
 * maar één ingrediënt tegelijk hoeven te matchen (bv. een vaste boodschap
 * die net is toegevoegd) — voor het opbouwen van een hele boodschappenlijst
 * met veel ingrediënten tegelijk gebruikt ensureShoppingList de
 * repository-functies rechtstreeks in batch, om een N+1-patroon te voorkomen.
 */
export async function matchProductForIngredient(
  householdId: string,
  ingredientId: string
): Promise<ProductMatchResult> {
  const [products, trustedMap, rejectedMap, productChoicePreference] = await Promise.all([
    // Alleen Picnic-producten, net als in `buildShoppingListLines`. Dit is
    // het pad voor álles wat níét de weekmenu-lijstopbouw is: een nieuwe
    // vaste boodschap, een voorraadwijziging, en het opnieuw matchen nadat de
    // gebruiker op /controle een product heeft afgewezen. Juist daar mag er
    // geen product van Albert Heijn of Dirk uit komen — dat is een
    // vergelijkingsproduct, geen bestelbaar artikel.
    prisma.product.findMany({ where: { ingredientId, provider: "PICNIC" } }),
    getTrustedPreferences(householdId, [ingredientId]),
    getRejectedProductIds(householdId, [ingredientId]),
    getHouseholdProductChoicePreference(householdId),
  ]);

  return matchProduct({
    candidates: products.map(toMatchCandidate),
    trusted: trustedMap.get(ingredientId) ?? null,
    rejectedProductIds: rejectedMap.get(ingredientId) ?? new Set(),
    productChoicePreference,
  });
}
