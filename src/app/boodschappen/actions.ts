"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold } from "@/lib/auth";
import { markTransferred } from "@/lib/picnicAdapter";
import { logFeedbackEvent } from "@/lib/feedback";
import { recordProductChosen } from "@/domain/product-matching/repository";
import {
  addShoppingListToPicnicCart,
  clearPicnicCartForShoppingList,
  type PicnicCartResult,
} from "@/lib/picnic/cartService";
import { buildConfirmationSummary, type ConfirmationSummary } from "@/lib/picnic/confirmationSummary";
import { describeLinePackaging } from "@/lib/shoppingList";

export async function confirmTransfer(formData: FormData) {
  const shoppingListId = String(formData.get("shoppingListId"));
  await assertShoppingListAccess(shoppingListId);
  await markTransferred(shoppingListId);
  revalidatePath("/boodschappen");
}

async function assertShoppingListAccess(shoppingListId: string) {
  const shoppingList = await prisma.shoppingList.findUniqueOrThrow({
    where: { id: shoppingListId },
    include: { mealPlan: { select: { householdId: true } } },
  });
  await assertCurrentHousehold(shoppingList.mealPlan.householdId);
  return shoppingList;
}

async function loadEditableShoppingLine(lineId: string) {
  const line = await prisma.shoppingListLine.findUniqueOrThrow({
    where: { id: lineId },
    include: { shoppingList: { include: { mealPlan: { select: { householdId: true } } } }, product: true },
  });
  await assertCurrentHousehold(line.shoppingList.mealPlan.householdId);
  return { line, householdId: line.shoppingList.mealPlan.householdId };
}

function redirectToBoodschappenLine(lineId: string, status?: string) {
  revalidatePath("/boodschappen");
  revalidatePath("/controle");
  const params = new URLSearchParams({ focusLine: lineId });
  if (status) params.set("status", status);
  redirect(`/boodschappen?${params.toString()}#day-line-${encodeURIComponent(lineId)}`);
}

function quantityStep(line: { unit: string; product: { packageQuantity: number | null } | null }) {
  if (line.product?.packageQuantity && line.product.packageQuantity > 0) return line.product.packageQuantity;
  return line.unit === "PIECE" ? 1 : 50;
}

export async function adjustBoodschappenLineQuantity(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const direction = String(formData.get("direction"));
  const { line } = await loadEditableShoppingLine(lineId);
  if (line.source === "FIXED") throw new Error("Gebruik de vaste-boodschappenregel om vaste boodschappen aan te passen.");

  const delta = quantityStep(line) * (direction === "decrease" ? -1 : 1);
  const nextQuantity = Math.max(quantityStep(line), line.quantity + delta);
  await prisma.shoppingListLine.update({
    where: { id: line.id },
    data: { quantity: nextQuantity },
  });

  redirectToBoodschappenLine(line.id, "quantity");
}

export async function setBoodschappenLinePackageCount(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const packageCount = Number(formData.get("packageCount"));
  const { line } = await loadEditableShoppingLine(lineId);
  if (line.source === "FIXED") throw new Error("Gebruik de vaste-boodschappenregel om vaste boodschappen aan te passen.");
  if (!Number.isFinite(packageCount) || packageCount <= 0) {
    throw new Error("Vul een geldig aantal groter dan 0 in.");
  }

  const nextQuantity =
    line.product?.packageQuantity && line.product.packageQuantity > 0
      ? packageCount * line.product.packageQuantity
      : packageCount;

  await prisma.shoppingListLine.update({
    where: { id: line.id },
    data: { quantity: nextQuantity },
  });

  redirectToBoodschappenLine(line.id, "quantity");
}

export async function chooseBoodschappenProduct(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const productId = String(formData.get("productId"));
  const remember = String(formData.get("remember")) === "true";
  const { line, householdId } = await loadEditableShoppingLine(lineId);
  if (line.source === "FIXED") throw new Error("Gebruik de vaste-boodschappenregel om vaste boodschappen aan te passen.");

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { ingredientId: true },
  });
  if (product.ingredientId !== line.ingredientId) {
    throw new Error("Dit product hoort niet bij deze boodschappenregel.");
  }

  if (line.productId && line.productId !== productId) {
    await logFeedbackEvent({
      householdId,
      subjectType: "PRODUCT",
      subjectId: line.productId,
      eventType: "REPLACED",
      explicit: true,
      context: { source: "boodschappen_day_review" },
    });
  }

  await prisma.shoppingListLine.update({
    where: { id: line.id },
    data: {
      productId,
      needsReview: false,
      matchStatus: "MANUALLY_SELECTED",
      matchConfidence: 1,
      matchReasons: [
        remember
          ? "Handmatig gekozen op de dagcontrole en onthouden."
          : "Alleen deze week gekozen op de dagcontrole.",
      ],
    },
  });

  await logFeedbackEvent({
    householdId,
    subjectType: "PRODUCT",
    subjectId: productId,
    eventType: "CHOSEN",
    explicit: true,
    context: { source: "boodschappen_day_review", onceOnly: !remember },
  });

  if (remember) {
    await recordProductChosen(householdId, line.ingredientId, productId, "MANUAL");
  }

  redirectToBoodschappenLine(line.id, remember ? "remembered" : "week-only");
}

export async function removeBoodschappenLineThisWeek(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const { line } = await loadEditableShoppingLine(lineId);
  if (line.source === "FIXED") throw new Error("Gebruik de vaste-boodschappenregel om vaste boodschappen aan te passen.");
  await prisma.shoppingListLine.delete({ where: { id: line.id } });
  revalidatePath("/boodschappen");
  revalidatePath("/controle");
  redirect("/boodschappen#daily-review");
}

/** Bevestigingssamenvatting vóór het echt vullen van het Picnic-mandje (Fase 7/8). */
export async function getPicnicConfirmationSummary(
  shoppingListId: string
): Promise<ConfirmationSummary> {
  await assertShoppingListAccess(shoppingListId);
  const shoppingList = await prisma.shoppingList.findUniqueOrThrow({
    where: { id: shoppingListId },
    include: { lines: { include: { ingredient: true, product: true } } },
  });

  return buildConfirmationSummary(
    shoppingList.lines.map((line) => ({
      ingredientName: line.ingredient.name,
      matchStatus: line.matchStatus,
      transferredToPicnicAt: line.transferredToPicnicAt,
      packageCount: line.product
        ? Math.max(
            1,
            describeLinePackaging(
              { quantity: line.quantity, unit: line.unit },
              { packageQuantity: line.product.packageQuantity }
            ).packagesToBuy || 1
          )
        : 1,
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
  await assertShoppingListAccess(shoppingListId);
  const result = await addShoppingListToPicnicCart(shoppingListId);
  if (result.notFound.length === 0 && result.errors.length === 0) {
    await markTransferred(shoppingListId);
  }
  revalidatePath("/boodschappen");
  return result;
}

export async function clearPicnicCart(shoppingListId: string): Promise<void> {
  await assertShoppingListAccess(shoppingListId);
  await clearPicnicCartForShoppingList(shoppingListId);
  revalidatePath("/boodschappen");
}
