"use server";

import { redirect } from "next/navigation";
import { signInByCredentials } from "@/lib/auth";

export async function loginToHousehold(formData: FormData) {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");

  try {
    await signInByCredentials(username, password);
  } catch {
    redirect("/login?status=wrong-credentials");
  }
  redirect("/");
}
