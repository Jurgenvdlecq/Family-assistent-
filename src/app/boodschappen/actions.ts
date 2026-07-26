"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { markTransferred } from "@/lib/picnicAdapter";
import {
  addShoppingListToPicnicCart,
  clearPicnicCartForShoppingList,
  type PicnicCartResult,
} from "@/lib/picnic/cartService";
import { buildConfirmationSummary, type ConfirmationSummary } from "@/lib/picnic/confirmationSummary";

export async function confirmTransfer(formData: FormData) {
  const shoppingListId = String(formData.get("shoppingListId"));
  await markTransferred(shoppingListId);
  revalidatePath("/boodschappen");
}

/** Bevestigingssamenvatting vóór het echt vullen van het Picnic-mandje (Fase 7/8). */
export async function getPicnicConfirmationSummary(
  shoppingListId: string
): Promise<ConfirmationSummary> {
  const shoppingList = await prisma.shoppingList.findUniqueOrThrow({
    where: { id: shoppingListId },
    include: { lines: { include: { ingredient: true, product: true } } },
  });

  return buildConfirmationSummary(
    shoppingList.lines.map((line) => ({
      ingredientName: line.ingredient.name,
      matchStatus: line.matchStatus,
      transferredToPicnicAt: line.transferredToPicnicAt,
      product: line.product
        ? {
            name: line.product.name,
            price: line.product.price !== null ? Number(line.product.price) : null,
            lastSeenAvailable: line.product.lastSeenAvailable,
          }
        : null,
    }))
  );
}

export async function addToPicnicCart(shoppingListId: string): Promise<PicnicCartResult> {
  const result = await addShoppingListToPicnicCart(shoppingListId);
  if (result.notFound.length === 0 && result.errors.length === 0) {
    await markTransferred(shoppingListId);
  }
  revalidatePath("/boodschappen");
  return result;
}

export async function clearPicnicCart(shoppingListId: string): Promise<void> {
  await clearPicnicCartForShoppingList(shoppingListId);
  revalidatePath("/boodschappen");
}
