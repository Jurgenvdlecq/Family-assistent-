import { prisma } from "./prisma";
import { getAttentionItems, type AttentionItem } from "@/domain/attention/attentionItems";

/**
 * Eén databasequery, hergebruikt door zowel de homepage als (later) de
 * pushscheduler (WP69) — vervangt de losse `shoppingList`+`reviewCount`-
 * query die de homepage hiervoor apart deed.
 */
export async function getAttentionItemsForMealPlan(
  mealPlanId: string,
  mealPlanCreatedAt: Date
): Promise<AttentionItem[]> {
  const shoppingList = await prisma.shoppingList.findUnique({
    where: { mealPlanId },
    select: {
      status: true,
      reviewFlaggedAt: true,
      reviewedAt: true,
      orderConfirmedAt: true,
      lines: { select: { needsReview: true, transferredToPicnicAt: true } },
    },
  });

  const reviewCount = shoppingList?.lines.filter((line) => line.needsReview).length ?? 0;
  const transferredAtDates = (shoppingList?.lines ?? [])
    .map((line) => line.transferredToPicnicAt)
    .filter((date): date is Date => date !== null);
  const lastTransferredAt =
    transferredAtDates.length > 0
      ? new Date(Math.max(...transferredAtDates.map((date) => date.getTime())))
      : null;

  return getAttentionItems({
    mealPlanCreatedAt,
    hasShoppingList: Boolean(shoppingList),
    reviewCount,
    reviewFlaggedAt: shoppingList?.reviewFlaggedAt ?? null,
    shoppingListStatus: shoppingList?.status ?? null,
    reviewedAt: shoppingList?.reviewedAt ?? null,
    hasTransferredLines: transferredAtDates.length > 0,
    lastTransferredAt,
    orderConfirmedAt: shoppingList?.orderConfirmedAt ?? null,
  });
}
