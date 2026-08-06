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
/**
 * `returnTo` komt uit een client-aangeleverd hidden formulierveld (zodat de
 * onboarding-tussenpagina na een koppelactie op zichzelf kan blijven i.p.v.
 * altijd naar /ons-gezin te springen) — vaste whitelist om open-redirect te
 * voorkomen, geen vrij pad accepteren.
 */
const ALLOWED_RETURN_PATHS = ["/ons-gezin", "/onboarding/picnic"] as const;

function redirectAfterPicnicAction(status: string, returnToInput: FormDataEntryValue | null): never {
  const returnTo = ALLOWED_RETURN_PATHS.includes(returnToInput as (typeof ALLOWED_RETURN_PATHS)[number])
    ? (returnToInput as string)
    : "/ons-gezin";
  revalidatePath(returnTo);
  redirect(`${returnTo}?status=${encodeURIComponent(status)}`);
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
  redirectAfterPicnicAction(OUTCOME_STATUS[outcome], formData.get("returnTo"));
}

export async function verifyPicnicTwoFactorCode(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const code = String(formData.get("code") ?? "").trim();

  const outcome = await verifyPicnicTwoFactorCodeForHousehold(householdId, code);
  redirectAfterPicnicAction(OUTCOME_STATUS[outcome], formData.get("returnTo"));
}

export async function cancelPicnicTwoFactor(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  await prisma.household.update({
    where: { id: householdId },
    data: { picnicPendingAuthToken: null },
  });
  redirectAfterPicnicAction("picnic-2fa-cancelled", formData.get("returnTo"));
}

export async function disconnectPicnicAccount(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  await prisma.household.update({
    where: { id: householdId },
    data: { picnicAuthToken: null, picnicTokenUpdatedAt: null, picnicPendingAuthToken: null },
  });
  redirectAfterPicnicAction("picnic-disconnected", formData.get("returnTo"));
}
