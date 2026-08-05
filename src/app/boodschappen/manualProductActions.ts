"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { recordProductChosen } from "@/domain/product-matching/repository";
import { resolvePicnicProductChoice } from "@/lib/picnicProductChoice";
import { removeBulkFixedGroceryLine } from "@/lib/fixedGroceryProductChoice";
import { assertShoppingListAccess } from "@/lib/shoppingListAccess";
import { Unit } from "@/generated/prisma/enums";

const VALID_UNITS = new Set(Object.values(Unit));

function parseQuantity(raw: FormDataEntryValue | null): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Vul een geldige hoeveelheid groter dan 0 in.");
  }
  return value;
}

function parseUnit(raw: FormDataEntryValue | null): Unit {
  const value = String(raw);
  if (!VALID_UNITS.has(value as Unit)) {
    throw new Error("Onbekende eenheid.");
  }
  return value as Unit;
}

function parseOptionalPrice(raw: FormDataEntryValue | null) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const parsed = Number(value.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

/**
 * Voegt een product eenmalig toe aan de boodschappenlijst van déze week —
 * in tegenstelling tot "vaste boodschappen" (fixedGroceriesActions.ts)
 * wordt dit nooit een blijvende wekelijkse gewoonte. Bedoeld als de
 * laagdrempelige manier om snel iets toe te voegen (bijv. voor kinderen,
 * gebruikersverzoek) zonder per ongeluk een permanente standaard te zetten.
 * Maakt bewust altijd een nieuwe regel aan (geen upsert-per-ingrediënt zoals
 * bij vaste boodschappen) — twee keer hetzelfde toevoegen geeft dus twee
 * regels, die net als elke andere regel gewoon weer te verwijderen zijn.
 */
export async function addManualProduct(formData: FormData) {
  const shoppingListId = String(formData.get("shoppingListId") ?? "");
  const shoppingList = await assertShoppingListAccess(shoppingListId);
  const householdId = shoppingList.mealPlan.householdId;

  const searchTerm = String(formData.get("searchTerm") ?? "").trim();
  const productName = String(formData.get("productName") ?? "").trim();
  const externalRef = String(formData.get("externalRef") ?? "").trim();
  const packageSize = String(formData.get("packageSize") ?? "").trim() || null;
  const picnicImageId = String(formData.get("picnicImageId") ?? "").trim() || null;
  const quantity = parseQuantity(formData.get("quantity"));
  const unit = parseUnit(formData.get("unit"));
  const price = parseOptionalPrice(formData.get("price"));

  const { ingredient, product } = await resolvePicnicProductChoice({
    searchTerm,
    productName,
    externalRef,
    packageSize,
    picnicImageId,
    price,
  });

  await recordProductChosen(householdId, ingredient.id, product.id);

  await prisma.shoppingListLine.create({
    data: {
      shoppingListId,
      ingredientId: ingredient.id,
      productId: product.id,
      quantity,
      unit,
      source: "MANUAL",
      needsReview: false,
      matchStatus: "MANUALLY_SELECTED",
      matchConfidence: 1,
      matchReasons: ["Handmatig toegevoegd voor deze week."],
    },
  });

  revalidatePath("/boodschappen");
  revalidatePath("/controle");

  // Kom je hier via "Zelf zoeken" bij een regel uit "Snel meerdere producten
  // toevoegen" (geen van de 3 voorstellen was goed)? Dan is deze regel nu
  // opgelost — streep 'm uit de resterende batchtekst en ga terug naar
  // #quick-order, zodat de rest van je lijstje in beeld blijft in plaats van
  // te verdwijnen achter deze op-zichzelf-staande zoekbox.
  const raw = String(formData.get("raw") ?? "").trim();
  if (raw) {
    const quickOrderText = String(formData.get("quickOrderText") ?? "");
    const remainingQuickOrderText = removeBulkFixedGroceryLine(quickOrderText, raw);
    if (remainingQuickOrderText) {
      const params = new URLSearchParams({ quickOrder: remainingQuickOrderText, status: "quick-order-added" });
      redirect(`/boodschappen?${params.toString()}#quick-order`);
    }
    redirect("/boodschappen?status=quick-order-added#quick-order");
  }

  redirect("/boodschappen?status=manual-added#quick-add-product");
}
