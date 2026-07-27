"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold } from "@/lib/auth";

const RECIPE_CATEGORIES = [
  "PASTA",
  "WRAPS",
  "RICE_DISH",
  "ALL_VEGGIE_DAY",
  "QUICK_AND_EASY",
  "COMFORT_FOOD",
  "AIRFRYER",
  "OTHER",
] as const;
const RECIPE_STATUSES = ["FOUND", "ADAPTED", "PROVEN", "SAFE_CHOICE"] as const;
const VARIANT_TYPES = ["FAST", "FRESH", "REHEATABLE", "KID_FRIENDLY"] as const;

function parseEnum<T extends readonly string[]>(value: FormDataEntryValue | null, allowed: T, fallback: T[number]) {
  const raw = String(value ?? fallback);
  return allowed.includes(raw) ? (raw as T[number]) : fallback;
}

function parseList(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function requireRecipeEditor(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  return householdId;
}

export async function createRecipe(formData: FormData) {
  await requireRecipeEditor(formData);
  const title = String(formData.get("title") ?? "").trim();
  const category = parseEnum(formData.get("category"), RECIPE_CATEGORIES, "OTHER");
  const variantType = parseEnum(formData.get("variantType"), VARIANT_TYPES, "FRESH");
  const source = String(formData.get("source") ?? "").trim() || null;
  const properties = parseList(formData.get("properties"));
  const instructions = parseList(formData.get("instructions"));
  const contextFit = parseList(formData.get("contextFit"));

  if (!title) throw new Error("Titel is verplicht.");

  const existing = await prisma.recipe.findUnique({ where: { title }, select: { id: true } });
  if (existing) throw new Error("Er bestaat al een recept met deze titel.");

  const ingredientRows = [];
  for (let index = 0; index < 8; index += 1) {
    const ingredientId = String(formData.get(`ingredientId-${index}`) ?? "");
    const quantity = Number(formData.get(`quantity-${index}`));
    if (!ingredientId) continue;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("Vul bij elk ingrediënt een hoeveelheid groter dan 0 in.");
    }
    ingredientRows.push({ ingredientId, quantity });
  }
  if (ingredientRows.length === 0) {
    throw new Error("Voeg minimaal één ingrediënt toe.");
  }

  const ingredients = await prisma.ingredient.findMany({
    where: { id: { in: ingredientRows.map((row) => row.ingredientId) } },
    select: { id: true, unit: true },
  });
  const unitByIngredientId = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient.unit]));
  if (ingredients.length !== ingredientRows.length) {
    throw new Error("Een gekozen ingrediënt bestaat niet meer.");
  }

  await prisma.recipe.create({
    data: {
      title,
      category,
      source,
      properties,
      instructions,
      status: "FOUND",
      ingredients: {
        create: ingredientRows.map((row) => ({
          ingredientId: row.ingredientId,
          quantity: row.quantity,
          unit: unitByIngredientId.get(row.ingredientId)!,
        })),
      },
      variants: {
        create: {
          variantType,
          contextFit,
        },
      },
    },
  });

  revalidatePath("/recepten");
  revalidatePath("/gerechten");
}

export async function updateRecipeDetails(formData: FormData) {
  await requireRecipeEditor(formData);
  const recipeId = String(formData.get("recipeId"));
  const title = String(formData.get("title") ?? "").trim();
  const source = String(formData.get("source") ?? "").trim() || null;
  const category = parseEnum(formData.get("category"), RECIPE_CATEGORIES, "OTHER");
  const status = parseEnum(formData.get("status"), RECIPE_STATUSES, "FOUND");
  const properties = parseList(formData.get("properties"));
  const instructions = parseList(formData.get("instructions"));

  if (!title) throw new Error("Titel is verplicht.");

  const existing = await prisma.recipe.findUnique({ where: { title }, select: { id: true } });
  if (existing && existing.id !== recipeId) {
    throw new Error("Er bestaat al een ander recept met deze titel.");
  }

  await prisma.recipe.update({
    where: { id: recipeId },
    data: { title, source, category, status, properties, instructions },
  });

  revalidatePath("/recepten");
  revalidatePath("/");
  revalidatePath("/gerechten");
}

export async function updateRecipeVariant(formData: FormData) {
  await requireRecipeEditor(formData);
  const variantId = String(formData.get("variantId"));
  const contextFit = parseList(formData.get("contextFit"));

  await prisma.recipeVariant.update({
    where: { id: variantId },
    data: { contextFit },
  });

  revalidatePath("/recepten");
  revalidatePath("/");
  revalidatePath("/gerechten");
}

export async function createRecipeVariant(formData: FormData) {
  await requireRecipeEditor(formData);
  const recipeId = String(formData.get("recipeId"));
  const variantType = parseEnum(formData.get("variantType"), VARIANT_TYPES, "FRESH");
  const contextFit = parseList(formData.get("contextFit"));

  const recipe = await prisma.recipe.findUnique({ where: { id: recipeId }, select: { id: true } });
  if (!recipe) throw new Error("Dit recept bestaat niet meer.");

  const existing = await prisma.recipeVariant.findUnique({
    where: { recipeId_variantType: { recipeId, variantType } },
    select: { id: true },
  });
  if (existing) {
    throw new Error("Deze variant bestaat al voor dit recept.");
  }

  await prisma.recipeVariant.create({
    data: { recipeId, variantType, contextFit },
  });

  revalidatePath("/recepten");
  revalidatePath("/");
  revalidatePath("/gerechten");
}
