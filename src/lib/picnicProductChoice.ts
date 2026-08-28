import { prisma } from "./prisma";
import { inferFixedGroceryQuantity, inferIngredientCategory, titleCaseSearchTerm } from "./fixedGroceryProductChoice";
import { parsePackageQuantity } from "./quantity/parsePackageSize";
import { recordPriceObservation } from "./pricing/observations";

export interface PicnicProductChoiceInput {
  searchTerm: string;
  productName: string;
  externalRef: string;
  packageSize: string | null;
  picnicImageId: string | null;
  price: number | null;
}

/**
 * Zet een gekozen Picnic-zoekresultaat om in een bestaand of nieuw
 * Ingredient + Product. Gedeeld tussen vaste boodschappen (FIXED, zie
 * fixedGroceriesActions.ts) en eenmalig toegevoegde producten (MANUAL, zie
 * manualProductActions.ts) — die twee verschillen alleen in wat er daarna
 * met de keuze gebeurt (een blijvende gewoonte worden of niet), niet in hoe
 * het Picnic-product zelf wordt opgeslagen.
 */
export async function resolvePicnicProductChoice(input: PicnicProductChoiceInput) {
  if (!input.productName || !input.externalRef) {
    throw new Error("Kies een geldig Picnic-product.");
  }

  const ingredientName = titleCaseSearchTerm(input.searchTerm || input.productName);
  const inferred = inferFixedGroceryQuantity(input.packageSize);
  const existingIngredient = await prisma.ingredient.findUnique({ where: { name: ingredientName } });
  const ingredient =
    existingIngredient ??
    (await prisma.ingredient.create({
      data: {
        name: ingredientName,
        unit: inferred.unit,
        category: inferIngredientCategory(ingredientName),
      },
    }));

  const productData = {
    ingredientId: ingredient.id,
    externalRef: input.externalRef,
    picnicImageId: input.picnicImageId,
    name: input.productName,
    packageSize: input.packageSize,
    packageQuantity: input.packageSize ? parsePackageQuantity(input.packageSize, ingredient.unit) : null,
    price: input.price,
    lastSeenAvailable: new Date(),
  };
  const product = await prisma.product.upsert({
    where: {
      ingredientId_provider_externalRef: {
        ingredientId: ingredient.id,
        provider: "PICNIC",
        externalRef: input.externalRef,
      },
    },
    update: productData,
    create: productData,
  });

  // Elke keer dat de app een Picnic-prijs ziet, wordt dat ook een waarneming.
  // Zo bouwt de prijsgeschiedenis zich vanzelf op vanaf het moment dat deze
  // laag bestaat — zonder dat er een aparte Picnic-verversing nodig is, en
  // zonder dat er iets aan het bestaande gedrag verandert.
  if (typeof input.price === "number" && Number.isFinite(input.price) && input.price >= 0) {
    await recordPriceObservation({
      productId: product.id,
      price: input.price,
      packageSize: input.packageSize ?? null,
      source: "API",
    });
  }

  return { ingredient, product };
}
