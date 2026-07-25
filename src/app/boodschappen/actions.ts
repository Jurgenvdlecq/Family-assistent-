"use server";

import { revalidatePath } from "next/cache";
import { markTransferred } from "@/lib/picnicAdapter";

export async function confirmTransfer(formData: FormData) {
  const shoppingListId = String(formData.get("shoppingListId"));
  await markTransferred(shoppingListId);
  revalidatePath("/boodschappen");
}
