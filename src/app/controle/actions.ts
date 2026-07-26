"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold } from "@/lib/auth";
import { logFeedbackEvent } from "@/lib/feedback";
import { recordProductChosen, recordProductRejected } from "@/domain/product-matching/repository";
import { matchProductForIngredient } from "@/domain/product-matching/matchIngredient";

async function loadLineForCurrentHousehold(lineId: string) {
  const line = await prisma.shoppingListLine.findUniqueOrThrow({
    where: { id: lineId },
    include: { shoppingList: { include: { mealPlan: { select: { householdId: true } } } } },
  });
  await assertCurrentHousehold(line.shoppingList.mealPlan.householdId);
  return { line, householdId: line.shoppingList.mealPlan.householdId };
}

export async function confirmProductChoice(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const productId = String(formData.get("productId"));
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);

  const { line } = await loadLineForCurrentHousehold(lineId);

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
  await assertCurrentHousehold(householdId);

  const { line } = await loadLineForCurrentHousehold(lineId);

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

/**
 * Kiest een alternatief voor déze keer, zonder het als nieuwe standaard-
 * voorkeur te onthouden (Fase 6: "alleen deze week gebruiken" is een aparte
 * actie naast "goedkeuren", die wél onthoudt).
 */
export async function useProductThisWeekOnly(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const productId = String(formData.get("productId"));
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);

  const { line } = await loadLineForCurrentHousehold(lineId);

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
      matchReasons: ["Alleen deze week gekozen — volgende week vraagt dit opnieuw om een keuze."],
    },
  });

  await logFeedbackEvent({
    householdId,
    subjectType: "PRODUCT",
    subjectId: productId,
    eventType: "CHOSEN",
    explicit: true,
    context: { source: "controle_screen", onceOnly: true },
  });

  revalidatePath("/controle");
  revalidatePath("/boodschappen");
}

/** Past de hoeveelheid van deze ene regel aan (bv. een twijfelgeval bleek toch meer of minder nodig te hebben). */
export async function adjustLineQuantity(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  await loadLineForCurrentHousehold(lineId);
  const quantity = Number(formData.get("quantity"));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Vul een geldige hoeveelheid groter dan 0 in.");
  }

  await prisma.shoppingListLine.update({ where: { id: lineId }, data: { quantity } });
  revalidatePath("/controle");
  revalidatePath("/boodschappen");
}

/** Verwijdert een regel volledig van de lijst — voor producten die niet gevonden zijn en niet nodig blijken. */
export async function removeLineFromList(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  await loadLineForCurrentHousehold(lineId);
  await prisma.shoppingListLine.delete({ where: { id: lineId } });
  revalidatePath("/controle");
  revalidatePath("/boodschappen");
}

export async function skipReview(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  await loadLineForCurrentHousehold(lineId);
  await prisma.shoppingListLine.update({
    where: { id: lineId },
    data: { needsReview: false },
  });
  revalidatePath("/controle");
  revalidatePath("/boodschappen");
}

export async function confirmShoppingList(formData: FormData) {
  const shoppingListId = String(formData.get("shoppingListId"));
  const shoppingList = await prisma.shoppingList.findUniqueOrThrow({
    where: { id: shoppingListId },
    include: { mealPlan: { select: { householdId: true } } },
  });
  await assertCurrentHousehold(shoppingList.mealPlan.householdId);
  await prisma.shoppingList.update({
    where: { id: shoppingListId },
    data: { status: "REVIEWED" },
  });
  revalidatePath("/boodschappen");
  redirect("/boodschappen");
}
