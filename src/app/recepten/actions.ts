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
const INGREDIENT_CATEGORIES = ["MEAT", "FISH", "DAIRY", "VEGETABLE", "FRUIT", "GRAIN", "LEGUME", "PANTRY", "OTHER"] as const;
const UNITS = ["GRAM", "PIECE", "ML"] as const;

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

async function invalidateCurrentShoppingList(householdId: string) {
  const { getCurrentWeekStart } = await import("@/lib/week");
  const weekStart = getCurrentWeekStart();
  const currentPlan = await prisma.mealPlan.findUnique({
    where: { householdId_weekStart: { householdId, weekStart } },
    select: { id: true },
  });
  if (!currentPlan) return;
  await prisma.shoppingList.deleteMany({ where: { mealPlanId: currentPlan.id } });
}

function revalidateRecipeManagementPaths() {
  revalidatePath("/recepten");
  revalidatePath("/");
  revalidatePath("/gerechten");
  revalidatePath("/boodschappen");
  revalidatePath("/controle");
}

async function parseRecipeIngredientRows(formData: FormData) {
  const rowCount = Number(formData.get("ingredientRowCount") ?? 0);
  const combined = new Map<string, number>();

  for (let index = 0; index < rowCount; index += 1) {
    const ingredientId = String(formData.get(`ingredientId-${index}`) ?? "");
    const quantityValue = formData.get(`quantity-${index}`);
    if (!ingredientId) continue;

    const quantity = Number(quantityValue);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("Vul bij elk gekozen ingrediënt een hoeveelheid groter dan 0 in.");
    }
    combined.set(ingredientId, (combined.get(ingredientId) ?? 0) + quantity);
  }

  const ingredientRows = Array.from(combined.entries()).map(([ingredientId, quantity]) => ({ ingredientId, quantity }));
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

  return ingredientRows.map((row) => ({
    ingredientId: row.ingredientId,
    quantity: row.quantity,
    unit: unitByIngredientId.get(row.ingredientId)!,
  }));
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

  const ingredientRows = await parseRecipeIngredientRows(formData);

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
          unit: row.unit,
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

  revalidateRecipeManagementPaths();
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

  revalidateRecipeManagementPaths();
}

export async function updateRecipeIngredients(formData: FormData) {
  const householdId = await requireRecipeEditor(formData);
  const recipeId = String(formData.get("recipeId"));
  const ingredientRows = await parseRecipeIngredientRows(formData);

  await prisma.recipe.findUniqueOrThrow({ where: { id: recipeId }, select: { id: true } });

  await prisma.$transaction([
    prisma.recipeIngredient.deleteMany({ where: { recipeId } }),
    prisma.recipeIngredient.createMany({
      data: ingredientRows.map((row) => ({ recipeId, ingredientId: row.ingredientId, quantity: row.quantity, unit: row.unit })),
    }),
  ]);

  await invalidateCurrentShoppingList(householdId);
  revalidateRecipeManagementPaths();
}

export async function updateRecipeVariant(formData: FormData) {
  await requireRecipeEditor(formData);
  const variantId = String(formData.get("variantId"));
  const contextFit = parseList(formData.get("contextFit"));

  await prisma.recipeVariant.update({
    where: { id: variantId },
    data: { contextFit },
  });

  revalidateRecipeManagementPaths();
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

  revalidateRecipeManagementPaths();
}

export async function createIngredient(formData: FormData) {
  await requireRecipeEditor(formData);
  const name = String(formData.get("name") ?? "").trim();
  const unit = parseEnum(formData.get("unit"), UNITS, "GRAM");
  const category = parseEnum(formData.get("category"), INGREDIENT_CATEGORIES, "OTHER");
  const restrictionTags = parseList(formData.get("restrictionTags"));
  const likelyInStock = formData.get("likelyInStock") === "on";

  if (!name) throw new Error("Ingrediëntnaam is verplicht.");

  await prisma.ingredient.create({
    data: { name, unit, category, restrictionTags, likelyInStock },
  });

  revalidateRecipeManagementPaths();
}

export async function updateIngredient(formData: FormData) {
  const householdId = await requireRecipeEditor(formData);
  const ingredientId = String(formData.get("ingredientId"));
  const name = String(formData.get("name") ?? "").trim();
  const category = parseEnum(formData.get("category"), INGREDIENT_CATEGORIES, "OTHER");
  const restrictionTags = parseList(formData.get("restrictionTags"));
  const likelyInStock = formData.get("likelyInStock") === "on";

  if (!name) throw new Error("Ingrediëntnaam is verplicht.");

  const existing = await prisma.ingredient.findUnique({ where: { name }, select: { id: true } });
  if (existing && existing.id !== ingredientId) {
    throw new Error("Er bestaat al een ander ingrediënt met deze naam.");
  }

  await prisma.ingredient.update({
    where: { id: ingredientId },
    data: { name, category, restrictionTags, likelyInStock },
  });

  await invalidateCurrentShoppingList(householdId);
  revalidateRecipeManagementPaths();
}
