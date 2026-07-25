"use server";

import { revalidatePath } from "next/cache";
import { markTransferred, addShoppingListToPicnicCart, type PicnicCartResult } from "@/lib/picnicAdapter";

export async function confirmTransfer(formData: FormData) {
  const shoppingListId = String(formData.get("shoppingListId"));
  await markTransferred(shoppingListId);
  revalidatePath("/boodschappen");
}

export async function addToPicnicCart(shoppingListId: string): Promise<PicnicCartResult> {
  const result = await addShoppingListToPicnicCart(shoppingListId);
  if (result.notFound.length === 0 && result.errors.length === 0) {
    await markTransferred(shoppingListId);
  }
  revalidatePath("/boodschappen");
  return result;
}
