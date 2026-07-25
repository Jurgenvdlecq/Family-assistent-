import { prisma } from "./prisma";
import type { Unit } from "@/generated/prisma/enums";

/**
 * Zorgt dat er een boodschappenlijst bestaat voor deze weekplanning —
 * automatisch afgeleid uit de gekozen maaltijden (sectie 10 van de
 * Blueprint: "Van maaltijd naar mandje"). Productmatching komt in fase 2;
 * dit is de ingrediëntenlijst zoals scherm "Boodschappen" die toont.
 */
export async function ensureShoppingList(mealPlanId: string) {
  const existing = await prisma.shoppingList.findUnique({
    where: { mealPlanId },
    include: { lines: { include: { ingredient: true } } },
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

  return prisma.shoppingList.create({
    data: {
      mealPlanId,
      status: "PREPARED",
      lines: {
        create: Array.from(totals.values()).map((t) => ({
          ingredientId: t.ingredientId,
          quantity: t.quantity,
          unit: t.unit,
          source: "MEAL",
          needsReview: false,
        })),
      },
    },
    include: { lines: { include: { ingredient: true } } },
  });
}

/** Wordt aangeroepen als de weekplanning wijzigt — de lijst moet dan opnieuw berekend worden. */
export async function invalidateShoppingList(mealPlanId: string) {
  await prisma.shoppingList.deleteMany({ where: { mealPlanId } });
}
