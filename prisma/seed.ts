import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { INGREDIENTS, RECIPES } from "./seed-data";

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  console.log(`Ingrediënten upserten (${INGREDIENTS.length})...`);
  const ingredientIdByName = new Map<string, string>();
  for (const ing of INGREDIENTS) {
    const row = await prisma.ingredient.upsert({
      where: { name: ing.name },
      update: { unit: ing.unit, category: ing.category },
      create: ing,
    });
    ingredientIdByName.set(ing.name, row.id);
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

    // Varianten opnieuw opbouwen (idempotent)
    await prisma.recipeVariant.deleteMany({ where: { recipeId: savedRecipe.id } });
    for (const v of variants) {
      await prisma.recipeVariant.create({
        data: {
          recipeId: savedRecipe.id,
          variantType: v.variantType,
          contextFit: v.contextFit,
        },
      });
    }
  }

  const recipeCount = await prisma.recipe.count();
  const variantCount = await prisma.recipeVariant.count();
  const ingredientCount = await prisma.ingredient.count();
  console.log(
    `Klaar: ${recipeCount} recepten, ${variantCount} varianten, ${ingredientCount} ingrediënten.`
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
