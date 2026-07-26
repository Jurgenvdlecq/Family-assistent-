import { prisma } from "@/lib/prisma";
import type { Product } from "@/generated/prisma/client";
import type { ProductPreferenceSource } from "@/generated/prisma/enums";
import type { MatchCandidate, TrustedPreference } from "./types";

export function toMatchCandidate(
  product: Pick<Product, "id" | "packageQuantity" | "lastSeenAvailable" | "price">
): MatchCandidate {
  return {
    id: product.id,
    packageQuantity: product.packageQuantity,
    lastSeenAvailable: product.lastSeenAvailable,
    price: product.price != null ? Number(product.price) : null,
  };
}

/** Vertrouwde voorkeur per ingrediënt, voor alle gevraagde ingrediënten in één query. */
export async function getTrustedPreferences(
  householdId: string,
  ingredientIds: string[]
): Promise<Map<string, TrustedPreference>> {
  if (ingredientIds.length === 0) return new Map();
  const rows = await prisma.householdProductPreference.findMany({
    where: { householdId, ingredientId: { in: ingredientIds } },
  });
  return new Map(rows.map((r) => [r.ingredientId, { productId: r.productId, timesChosen: r.timesChosen }]));
}

/** Afgewezen product-ids per ingrediënt, voor alle gevraagde ingrediënten in één query. */
export async function getRejectedProductIds(
  householdId: string,
  ingredientIds: string[]
): Promise<Map<string, Set<string>>> {
  if (ingredientIds.length === 0) return new Map();
  const rows = await prisma.rejectedProductMatch.findMany({
    where: { householdId, ingredientId: { in: ingredientIds } },
  });
  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = map.get(row.ingredientId) ?? new Set<string>();
    set.add(row.productId);
    map.set(row.ingredientId, set);
  }
  return map;
}

/**
 * Legt vast dat dit product voor dit ingrediënt is gekozen. Herbevestigen
 * van hetzelfde product verhoogt timesChosen; een ander product wordt de
 * nieuwe voorkeur met een verse telling (het oude aantal zegt niets over
 * het nieuwe product).
 */
export async function recordProductChosen(
  householdId: string,
  ingredientId: string,
  productId: string,
  source: ProductPreferenceSource = "MANUAL"
) {
  const existing = await prisma.householdProductPreference.findUnique({
    where: { householdId_ingredientId: { householdId, ingredientId } },
  });
  if (existing && existing.productId === productId) {
    return prisma.householdProductPreference.update({
      where: { id: existing.id },
      data: { timesChosen: { increment: 1 }, lastChosenAt: new Date(), source },
    });
  }
  return prisma.householdProductPreference.upsert({
    where: { householdId_ingredientId: { householdId, ingredientId } },
    update: { productId, timesChosen: 1, lastChosenAt: new Date(), source },
    create: { householdId, ingredientId, productId, timesChosen: 1, source },
  });
}

/** Sluit een product uit van toekomstige automatische matches voor dit ingrediënt. */
export async function recordProductRejected(
  householdId: string,
  ingredientId: string,
  productId: string,
  reason?: string
) {
  return prisma.rejectedProductMatch.upsert({
    where: { householdId_ingredientId_productId: { householdId, ingredientId, productId } },
    update: { reason },
    create: { householdId, ingredientId, productId, reason },
  });
}
