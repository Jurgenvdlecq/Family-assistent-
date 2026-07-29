"use server";

import { redirect } from "next/navigation";
import { signInByAccessCode } from "@/lib/auth";

export async function loginToHousehold(formData: FormData) {
  const accessCode = String(formData.get("accessCode") ?? "");

  try {
    await signInByAccessCode(accessCode);
  } catch {
    redirect("/login?status=wrong-code");
  }
  redirect("/");
}
