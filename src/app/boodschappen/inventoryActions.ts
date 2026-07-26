"use server";

import { revalidatePath } from "next/cache";
import { setInventoryStatus } from "@/lib/inventory";
import { syncShoppingListForInventoryChange } from "@/lib/shoppingList";
import type { InventoryStatus } from "@/generated/prisma/enums";

const VALID_STATUSES = new Set(["SUFFICIENT", "LOW", "OUT_OF_STOCK", "UNKNOWN"]);

export async function updateInventoryStatus(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  const ingredientId = String(formData.get("ingredientId"));
  const status = String(formData.get("status"));

  if (!VALID_STATUSES.has(status)) {
    throw new Error("Onbekende voorraadstatus.");
  }

  await setInventoryStatus(householdId, ingredientId, status as InventoryStatus);
  // De boodschappenlijst van deze week bestaat mogelijk al (gegenereerd bij
  // het eerste bezoek) — die moet meteen de nieuwe status weerspiegelen, niet
  // pas volgende week.
  await syncShoppingListForInventoryChange(householdId, ingredientId);
  revalidatePath("/boodschappen");
}
