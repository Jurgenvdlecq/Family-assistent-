"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { logFeedbackEvent } from "@/lib/feedback";
import { recordProductChosen, recordProductRejected } from "@/domain/product-matching/repository";
import { matchProductForIngredient } from "@/domain/product-matching/matchIngredient";

export async function confirmProductChoice(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const productId = String(formData.get("productId"));
  const householdId = String(formData.get("householdId"));

  const line = await prisma.shoppingListLine.findUniqueOrThrow({ where: { id: lineId } });

  if (line.productId && line.productId !== productId) {
    await logFeedbackEvent({
      householdId,
      subjectType: "PRODUCT",
      subjectId: line.productId,
      eventType: "REPLACED",
      explicit: true,
    });
  }

  await prisma.shoppingListLine.update({
    where: { id: lineId },
    data: {
      productId,
      needsReview: false,
      matchStatus: "MANUALLY_SELECTED",
      matchConfidence: 1,
      matchReasons: ["Handmatig gekozen op het Controle-scherm."],
    },
  });

  await logFeedbackEvent({
    householdId,
    subjectType: "PRODUCT",
    subjectId: productId,
    eventType: "CHOSEN",
    explicit: true,
    context: { source: "controle_screen" },
  });

  // Vertrouwde keuze onthouden — volgende week is dit geen twijfelgeval meer
  // (productkeuze-prioriteitsregel #1 uit sectie 10 van de Blueprint).
  await recordProductChosen(householdId, line.ingredientId, productId, "MANUAL");

  revalidatePath("/controle");
  revalidatePath("/boodschappen");
}

/**
 * Wijst een voorgesteld product expliciet af: het komt niet meer terug als
 * automatische suggestie voor dit ingrediënt (Fase 5: "afgewezen
 * producten"), en de regel wordt meteen opnieuw gematcht met de overige
 * kandidaten.
 */
export async function rejectProductChoice(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const productId = String(formData.get("productId"));
  const householdId = String(formData.get("householdId"));

  const line = await prisma.shoppingListLine.findUniqueOrThrow({ where: { id: lineId } });

  await recordProductRejected(householdId, line.ingredientId, productId);
  await logFeedbackEvent({
    householdId,
    subjectType: "PRODUCT",
    subjectId: productId,
    eventType: "IGNORED",
    explicit: true,
    context: { source: "controle_screen" },
  });

  const match = await matchProductForIngredient(householdId, line.ingredientId);
  await prisma.shoppingListLine.update({
    where: { id: lineId },
    data: {
      productId: match.productId,
      needsReview: match.status !== "MATCHED_TRUSTED",
      matchStatus: match.status,
      matchConfidence: match.confidence,
      matchReasons: match.reasons,
    },
  });

  revalidatePath("/controle");
  revalidatePath("/boodschappen");
}

export async function skipReview(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  await prisma.shoppingListLine.update({
    where: { id: lineId },
    data: { needsReview: false },
  });
  revalidatePath("/controle");
  revalidatePath("/boodschappen");
}

export async function confirmShoppingList(formData: FormData) {
  const shoppingListId = String(formData.get("shoppingListId"));
  await prisma.shoppingList.update({
    where: { id: shoppingListId },
    data: { status: "REVIEWED" },
  });
  revalidatePath("/boodschappen");
  redirect("/boodschappen");
}
