import { prisma } from "./prisma";
import type { Unit } from "@/generated/prisma/enums";

/**
 * Zorgt dat er een boodschappenlijst bestaat voor deze weekplanning —
 * automatisch afgeleid uit de gekozen maaltijden (sectie 10 van de
 * Blueprint: "Van maaltijd naar mandje").
 *
 * Productkeuze volgt de prioriteitsregel uit sectie 10: eerdere,
 * expliciet vertrouwde keuze (Preference) wint altijd. Zonder zo'n
 * voorkeur en met meerdere kandidaat-producten is het een twijfelgeval
 * (needsReview) dat op het Controle-scherm om een keuze vraagt.
 */
export async function ensureShoppingList(mealPlanId: string, householdId: string) {
  const existing = await prisma.shoppingList.findUnique({
    where: { mealPlanId },
    include: {
      lines: {
        include: { ingredient: true, product: true },
      },
    },
  });
  if (existing) return existing;

  const mealPlan = await prisma.mealPlan.findUniqueOrThrow({
    where: { id: mealPlanId },
    include: {
      entries: {
        include: {
          recipeVariant: {
            include: {
              recipe: { include: { ingredients: { include: { ingredient: true } } } },
            },
          },
        },
      },
    },
  });

  type Agg = { ingredientId: string; quantity: number; unit: Unit };
  const totals = new Map<string, Agg>();
  for (const entry of mealPlan.entries) {
    for (const ri of entry.recipeVariant.recipe.ingredients) {
      const key = `${ri.ingredientId}:${ri.unit}`;
      const current = totals.get(key);
      if (current) {
        current.quantity += ri.quantity;
      } else {
        totals.set(key, { ingredientId: ri.ingredientId, quantity: ri.quantity, unit: ri.unit });
      }
    }
  }

  const ingredientIds = Array.from(totals.values()).map((t) => t.ingredientId);
  const [allCandidates, productPreferences] = await Promise.all([
    prisma.product.findMany({ where: { ingredientId: { in: ingredientIds } } }),
    prisma.preference.findMany({
      where: {
        ownerType: "HOUSEHOLD",
        ownerId: householdId,
        subjectType: "PRODUCT",
        stance: "LIKED",
      },
    }),
  ]);

  const candidatesByIngredient = new Map<string, typeof allCandidates>();
  for (const product of allCandidates) {
    if (!product.ingredientId) continue;
    const list = candidatesByIngredient.get(product.ingredientId) ?? [];
    list.push(product);
    candidatesByIngredient.set(product.ingredientId, list);
  }
  const trustedProductIds = new Set(productPreferences.map((p) => p.subjectId));

  const lines = Array.from(totals.values()).map((t) => {
    const candidates = candidatesByIngredient.get(t.ingredientId) ?? [];
    const trusted = candidates.find((c) => trustedProductIds.has(c.id));

    let productId: string | null = null;
    let needsReview = false;

    if (trusted) {
      productId = trusted.id;
      needsReview = false;
    } else if (candidates.length === 1) {
      productId = candidates[0].id;
      needsReview = false;
    } else if (candidates.length > 1) {
      productId = candidates[0].id; // voorlopige suggestie, gebruiker beslist
      needsReview = true;
    } else {
      productId = null; // geen product gevonden — ook een twijfelgeval
      needsReview = true;
    }

    return {
      ingredientId: t.ingredientId,
      productId,
      quantity: t.quantity,
      unit: t.unit,
      source: "MEAL" as const,
      needsReview,
    };
  });

  return prisma.shoppingList.create({
    data: {
      mealPlanId,
      status: "PREPARED",
      lines: { create: lines },
    },
    include: {
      lines: { include: { ingredient: true, product: true } },
    },
  });
}

/** Wordt aangeroepen als de weekplanning wijzigt — de lijst moet dan opnieuw berekend worden. */
export async function invalidateShoppingList(mealPlanId: string) {
  await prisma.shoppingList.deleteMany({ where: { mealPlanId } });
}

export async function getShoppingListCandidates(ingredientId: string) {
  return prisma.product.findMany({ where: { ingredientId } });
}
