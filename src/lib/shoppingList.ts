import { prisma } from "./prisma";
import type { Unit } from "@/generated/prisma/enums";

type ProductCandidate = { id: string };

/**
 * Productkeuze volgt de prioriteitsregel uit sectie 10 van de Blueprint:
 * eerdere, expliciet vertrouwde keuze (Preference) wint altijd. Zonder zo'n
 * voorkeur en met meerdere kandidaat-producten is het een twijfelgeval
 * (needsReview) dat op het Controle-scherm om een keuze vraagt. Gedeeld
 * tussen receptregels (MEAL) en vaste boodschappen (FIXED) — dezelfde regel
 * geldt voor allebei.
 */
export function resolveProductChoice<T extends ProductCandidate>(
  candidates: T[],
  trustedProductIds: Set<string>
): { productId: string | null; needsReview: boolean } {
  const trusted = candidates.find((c) => trustedProductIds.has(c.id));
  if (trusted) return { productId: trusted.id, needsReview: false };
  if (candidates.length === 1) return { productId: candidates[0].id, needsReview: false };
  if (candidates.length > 1) {
    return { productId: candidates[0].id, needsReview: true }; // voorlopige suggestie, gebruiker beslist
  }
  return { productId: null, needsReview: true }; // geen product gevonden — ook een twijfelgeval
}

/**
 * Zorgt dat er een boodschappenlijst bestaat voor deze weekplanning —
 * automatisch afgeleid uit de gekozen maaltijden (sectie 10 van de
 * Blueprint: "Van maaltijd naar mandje") én aangevuld met de vaste
 * boodschappen van het huishouden (Fase 4).
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

  const [mealPlan, fixedGroceries] = await Promise.all([
    prisma.mealPlan.findUniqueOrThrow({
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
    }),
    prisma.fixedGrocery.findMany({ where: { householdId } }),
  ]);

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

  const ingredientIds = new Set(Array.from(totals.values()).map((t) => t.ingredientId));
  for (const fixed of fixedGroceries) ingredientIds.add(fixed.ingredientId);

  const [allCandidates, productPreferences] = await Promise.all([
    prisma.product.findMany({ where: { ingredientId: { in: Array.from(ingredientIds) } } }),
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

  const mealLines = Array.from(totals.values()).map((t) => {
    const { productId, needsReview } = resolveProductChoice(
      candidatesByIngredient.get(t.ingredientId) ?? [],
      trustedProductIds
    );
    return {
      ingredientId: t.ingredientId,
      productId,
      quantity: t.quantity,
      unit: t.unit,
      source: "MEAL" as const,
      needsReview,
    };
  });

  const fixedLines = fixedGroceries.map((fixed) => {
    const { productId, needsReview } = resolveProductChoice(
      candidatesByIngredient.get(fixed.ingredientId) ?? [],
      trustedProductIds
    );
    return {
      ingredientId: fixed.ingredientId,
      productId,
      quantity: fixed.quantity,
      unit: fixed.unit,
      source: "FIXED" as const,
      needsReview,
    };
  });

  return prisma.shoppingList.create({
    data: {
      mealPlanId,
      status: "PREPARED",
      lines: { create: [...mealLines, ...fixedLines] },
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
