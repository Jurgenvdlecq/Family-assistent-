"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCurrentHousehold } from "@/lib/auth";
import { FulfillmentSource } from "@/generated/prisma/enums";

const VALID = new Set(Object.values(FulfillmentSource));

/**
 * Legt vast waar een product vandaan komt: via Picnic, uit een andere winkel,
 * of iets wat iemand zelf regelt.
 *
 * Geldt vanaf nu voor élke regel met dit ingrediënt — ook volgende week. Dat
 * is de bedoeling: "biefstuk halen wij bij de slager" is geen eigenschap van
 * één boodschappenlijst maar van het huishouden.
 *
 * De regel-id uit het formulier wordt alleen gebruikt om het ingrediënt op te
 * zoeken binnen de lijst van het eigen huishouden — een gemanipuleerd
 * formulier kan daarmee hooguit een eigen regel raken.
 */
export async function setIngredientFulfillment(formData: FormData) {
  const household = await requireCurrentHousehold();
  const lineId = String(formData.get("lineId"));
  const fulfillment = String(formData.get("fulfillment"));
  if (!VALID.has(fulfillment as FulfillmentSource)) throw new Error("Onbekende herkomst.");

  const line = await prisma.shoppingListLine.findFirst({
    where: { id: lineId, shoppingList: { mealPlan: { householdId: household.id } } },
    select: { id: true, ingredientId: true, transferredToPicnicAt: true },
  });
  if (!line) throw new Error("Onbekende regel.");

  if (fulfillment === "PICNIC") {
    await prisma.householdIngredientFulfillment.deleteMany({
      where: { householdId: household.id, ingredientId: line.ingredientId },
    });
  } else {
    await prisma.householdIngredientFulfillment.upsert({
      where: {
        householdId_ingredientId: { householdId: household.id, ingredientId: line.ingredientId },
      },
      create: {
        householdId: household.id,
        ingredientId: line.ingredientId,
        fulfillment: fulfillment as FulfillmentSource,
      },
      update: { fulfillment: fulfillment as FulfillmentSource },
    });
  }

  // De regels van déze week meteen meenemen — anders zou de instelling pas
  // volgende week zichtbaar worden, zonder dat ergens te zeggen. Regels die
  // al in het Picnic-mandje liggen blijven ongemoeid: die zijn al besteld, en
  // ze alsnog als "zelf halen" tonen zou liegen.
  await prisma.shoppingListLine.updateMany({
    where: {
      ingredientId: line.ingredientId,
      transferredToPicnicAt: null,
      shoppingList: { mealPlan: { householdId: household.id } },
    },
    data: { fulfillment: fulfillment as FulfillmentSource },
  });

  revalidatePath("/boodschappen");
  revalidatePath("/controle");
  redirect(`/boodschappen?status=fulfillment-saved&regel=${encodeURIComponent(line.id)}#jullie-boodschappenlijst`);
}
