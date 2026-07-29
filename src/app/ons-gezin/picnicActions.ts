"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold } from "@/lib/auth";
import {
  connectPicnicAccountForHousehold,
  verifyPicnicTwoFactorCodeForHousehold,
  type PicnicConnectOutcome,
} from "@/lib/picnic/accountConnection";

/**
 * Picnic koppelen vanuit de app (Fase 7): e-mailadres en wachtwoord komen
 * hier alleen binnen om rechtstreeks bij Picnic in te loggen en worden
 * daarna meteen weggegooid — alleen het resulterende sessie-token wordt
 * opgeslagen. Vervangt scripts/picnic-login.ts als primaire route; dat
 * script blijft als terugvaloptie werken. De eigenlijke logica staat in
 * lib/picnic/accountConnection.ts, los van deze dunne autorisatie- en
 * redirect-laag, zodat die met een gefakete fetch getest kan worden.
 */
function redirectToOnsGezin(status: string): never {
  revalidatePath("/ons-gezin");
  redirect(`/ons-gezin?status=${encodeURIComponent(status)}`);
}

const OUTCOME_STATUS: Record<PicnicConnectOutcome | "twoFactorExpired" | "twoFactorWrongCode", string> = {
  connected: "picnic-connected",
  twoFactorNeeded: "picnic-2fa-needed",
  twoFactorGenerateFailed: "picnic-2fa-generate-failed",
  wrongCredentials: "picnic-wrong-credentials",
  networkError: "picnic-network-error",
  missingFields: "picnic-missing-fields",
  failed: "picnic-connect-failed",
  twoFactorExpired: "picnic-2fa-expired",
  twoFactorWrongCode: "picnic-2fa-wrong-code",
};

export async function connectPicnicAccount(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const outcome = await connectPicnicAccountForHousehold(householdId, username, password);
  redirectToOnsGezin(OUTCOME_STATUS[outcome]);
}

export async function verifyPicnicTwoFactorCode(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const code = String(formData.get("code") ?? "").trim();

  const outcome = await verifyPicnicTwoFactorCodeForHousehold(householdId, code);
  redirectToOnsGezin(OUTCOME_STATUS[outcome]);
}

export async function cancelPicnicTwoFactor(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  await prisma.household.update({
    where: { id: householdId },
    data: { picnicPendingAuthToken: null },
  });
  redirectToOnsGezin("picnic-2fa-cancelled");
}

export async function disconnectPicnicAccount(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  await prisma.household.update({
    where: { id: householdId },
    data: { picnicAuthToken: null, picnicTokenUpdatedAt: null, picnicPendingAuthToken: null },
  });
  redirectToOnsGezin("picnic-disconnected");
}
