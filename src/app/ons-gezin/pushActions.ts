"use server";

import { revalidatePath } from "next/cache";
import { assertCurrentHousehold } from "@/lib/auth";
import {
  savePushSubscription,
  removePushSubscription,
  setNotificationPreference,
} from "@/lib/notifications";
import type { AttentionItemType } from "@/domain/attention/attentionItems";

export async function subscribeToPush(
  householdId: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent: string | undefined
): Promise<void> {
  await assertCurrentHousehold(householdId);
  await savePushSubscription(householdId, subscription, userAgent);
  revalidatePath("/ons-gezin");
}

export async function unsubscribeFromPush(householdId: string, endpoint: string): Promise<void> {
  await assertCurrentHousehold(householdId);
  await removePushSubscription(householdId, endpoint);
  revalidatePath("/ons-gezin");
}

export async function updateNotificationPreference(
  householdId: string,
  type: AttentionItemType,
  enabled: boolean
): Promise<void> {
  await assertCurrentHousehold(householdId);
  await setNotificationPreference(householdId, type, enabled);
  revalidatePath("/ons-gezin");
}
