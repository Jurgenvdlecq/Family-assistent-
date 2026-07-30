import { prisma } from "./prisma";
import { inferFixedGroceryQuantity, inferIngredientCategory, titleCaseSearchTerm } from "./fixedGroceryProductChoice";
import { parsePackageQuantity } from "./quantity/parsePackageSize";

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

  return { ingredient, product };
}
