"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { logFeedbackEvent } from "@/lib/feedback";

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
    data: { productId, needsReview: false },
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
  await prisma.preference.upsert({
    where: {
      ownerType_ownerId_subjectType_subjectId: {
        ownerType: "HOUSEHOLD",
        ownerId: householdId,
        subjectType: "PRODUCT",
        subjectId: productId,
      },
    },
    update: { stance: "LIKED", source: "EXPLICIT", confidence: 1 },
    create: {
      ownerType: "HOUSEHOLD",
      ownerId: householdId,
      subjectType: "PRODUCT",
      subjectId: productId,
      stance: "LIKED",
      source: "EXPLICIT",
      confidence: 1,
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
