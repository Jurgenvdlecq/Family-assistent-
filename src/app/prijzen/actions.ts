"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCurrentHousehold } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ProductProvider } from "@/generated/prisma/enums";

const PROVIDERS: ProductProvider[] = ["AH", "DIRK"];

/**
 * "Nee, bij deze winkel kopen we dít."
 *
 * De ids komen van de client, dus wordt hier alles opnieuw gecontroleerd: het
 * ingrediënt moet daadwerkelijk op de boodschappenlijst van dít huishouden
 * staan, en het product moet bij dát ingrediënt en bij die winkel horen. Zonder
 * die controles zou een aangepast formulier een keuze kunnen opslaan bij een
 * ander huishouden of bij een willekeurig product.
 */
export async function chooseStoreProduct(formData: FormData) {
  const household = await requireCurrentHousehold();
  const ingredientId = String(formData.get("ingredientId") ?? "").trim();
  const productId = String(formData.get("productId") ?? "").trim();
  const provider = String(formData.get("provider") ?? "").trim() as ProductProvider;
  const lineId = String(formData.get("lineId") ?? "").trim();
  if (!ingredientId || !productId || !PROVIDERS.includes(provider)) return;

  // Staat dit ingrediënt wel op een lijst van dit huishouden? Zo niet, dan is
  // er niets te corrigeren en slaan we ook niets op.
  const onOwnList = await prisma.shoppingListLine.findFirst({
    where: { ingredientId, shoppingList: { mealPlan: { householdId: household.id } } },
    select: { id: true },
  });
  if (!onOwnList) return;

  // Hoort het product bij dit ingrediënt én bij deze winkel? Een product van
  // een andere winkel kiezen zou een vergelijking opleveren die nergens op slaat.
  const product = await prisma.product.findFirst({
    where: { id: productId, ingredientId, provider },
    select: { id: true },
  });
  if (!product) return;

  await prisma.householdStoreProductChoice.upsert({
    where: { householdId_ingredientId_provider: { householdId: household.id, ingredientId, provider } },
    update: { productId, chosenAt: new Date() },
    create: { householdId: household.id, ingredientId, productId, provider },
  });

  revalidatePath("/prijzen");
  // De samenvattingsregel op de boodschappenlijst hangt van dezelfde keuze af.
  revalidatePath("/boodschappen");
  // Terug naar dezelfde regel, niet naar de bovenkant van de pagina. De id komt
  // van de client, dus gecodeerd — anders breekt een rare waarde de URL.
  const anchor = encodeURIComponent(lineId);
  redirect(`/prijzen?focus=${anchor}&status=keuze-opgeslagen#regel-${anchor}`);
}

/** De correctie weer loslaten: vanaf nu kiest de app zelf weer. */
export async function clearStoreProductChoice(formData: FormData) {
  const household = await requireCurrentHousehold();
  const ingredientId = String(formData.get("ingredientId") ?? "").trim();
  const provider = String(formData.get("provider") ?? "").trim() as ProductProvider;
  const lineId = String(formData.get("lineId") ?? "").trim();
  if (!ingredientId || !PROVIDERS.includes(provider)) return;

  await prisma.householdStoreProductChoice.deleteMany({
    where: { householdId: household.id, ingredientId, provider },
  });

  revalidatePath("/prijzen");
  revalidatePath("/boodschappen");
  const anchor = encodeURIComponent(lineId);
  redirect(`/prijzen?focus=${anchor}&status=keuze-gewist#regel-${anchor}`);
}
