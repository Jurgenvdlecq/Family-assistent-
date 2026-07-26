"use server";

import { redirect } from "next/navigation";
import { signInToHousehold } from "@/lib/auth";

export async function loginToHousehold(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  const accessCode = String(formData.get("accessCode") ?? "");

  await signInToHousehold(householdId, accessCode);
  redirect("/");
}
