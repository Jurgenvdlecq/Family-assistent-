import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { INGREDIENTS, RECIPES } from "./seed-data";
import { PRODUCTS } from "./product-seed-data";
import { parsePackageQuantity } from "../src/lib/quantity/parsePackageSize";

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  console.log(`Ingrediënten upserten (${INGREDIENTS.length})...`);
  const ingredientIdByName = new Map<string, string>();
  const ingredientUnitByName = new Map<string, (typeof INGREDIENTS)[number]["unit"]>();
  for (const ing of INGREDIENTS) {
    const row = await prisma.ingredient.upsert({
      where: { name: ing.name },
      update: { unit: ing.unit, category: ing.category, restrictionTags: ing.restrictionTags ?? [] },
      create: { ...ing, restrictionTags: ing.restrictionTags ?? [] },
    });
    ingredientIdByName.set(ing.name, row.id);
    ingredientUnitByName.set(ing.name, ing.unit);
  }

  console.log(`Recepten upserten (${RECIPES.length})...`);
  for (const recipe of RECIPES) {
    const { ingredients, variants, ...recipeFields } = recipe;

    const savedRecipe = await prisma.recipe.upsert({
      where: { title: recipe.title },
      update: recipeFields,
      create: recipeFields,
    });

    // Ingrediënten van dit recept opnieuw opbouwen (idempotent)
    await prisma.recipeIngredient.deleteMany({ where: { recipeId: savedRecipe.id } });
    for (const ri of ingredients) {
      const ingredientId = ingredientIdByName.get(ri.ingredient);
      if (!ingredientId) {
        throw new Error(
          `Onbekend ingrediënt "${ri.ingredient}" in recept "${recipe.title}" — voeg het toe aan INGREDIENTS.`
        );
      }
      await prisma.recipeIngredient.create({
        data: {
          recipeId: savedRecipe.id,
          ingredientId,
          quantity: ri.quantity,
          unit: ri.unit,
        },
      });
    }

    // Varianten upserten — niet verwijderen: bestaande weekplanningen
    // verwijzen naar recipeVariant.id en mogen niet breken.
    for (const v of variants) {
      await prisma.recipeVariant.upsert({
        where: { recipeId_variantType: { recipeId: savedRecipe.id, variantType: v.variantType } },
        update: { contextFit: v.contextFit },
        create: {
          recipeId: savedRecipe.id,
          variantType: v.variantType,
          contextFit: v.contextFit,
        },
      });
    }
  }

  console.log(`Producten koppelen (${PRODUCTS.length} ingrediënten)...`);
  for (const mapping of PRODUCTS) {
    const ingredientId = ingredientIdByName.get(mapping.ingredient);
    if (!ingredientId) {
      throw new Error(
        `Onbekend ingrediënt "${mapping.ingredient}" in PRODUCTS — voeg het toe aan INGREDIENTS.`
      );
    }
    // Niet opnieuw aanmaken als dit ingrediënt al producten heeft (idempotent,
    // en voorkomt FK-problemen met bestaande ShoppingListLine-verwijzingen).
    const alreadySeeded = await prisma.product.findFirst({ where: { ingredientId } });
    if (alreadySeeded) continue;

    const ingredientUnit = ingredientUnitByName.get(mapping.ingredient)!;
    for (const candidate of mapping.candidates) {
      await prisma.product.create({
        data: {
          ingredientId,
          name: candidate.name,
          brand: candidate.brand,
          packageSize: candidate.packageSize,
          packageQuantity: parsePackageQuantity(candidate.packageSize, ingredientUnit),
          price: candidate.price,
          lastSeenAvailable: new Date(),
        },
      });
    }
  }

  const recipeCount = await prisma.recipe.count();
  const variantCount = await prisma.recipeVariant.count();
  const ingredientCount = await prisma.ingredient.count();
  const productCount = await prisma.product.count();
  console.log(
    `Klaar: ${recipeCount} recepten, ${variantCount} varianten, ${ingredientCount} ingrediënten, ${productCount} producten.`
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
