"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold } from "@/lib/auth";
import { DAY_KEYS, DAY_ENUM, type DayKey } from "@/lib/week";

function redirectToOnsGezin(status: string): never {
  revalidatePath("/ons-gezin");
  redirect(`/ons-gezin?status=${encodeURIComponent(status)}`);
}

function assertValidTime(time: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error("Kies een geldige tijd (uu:mm).");
  }
}

export async function updatePicnicDeliveryPreference(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);

  const dayKey = String(formData.get("dayKey")) as DayKey;
  if (!DAY_KEYS.includes(dayKey)) {
    throw new Error("Onbekende dag.");
  }
  const preferredTime = String(formData.get("preferredTime"));
  assertValidTime(preferredTime);

  const windowMinutes = Number(formData.get("windowMinutes"));
  if (!Number.isFinite(windowMinutes) || windowMinutes < 0 || windowMinutes > 240) {
    throw new Error("Kies een marge tussen 0 en 240 minuten.");
  }
  const reminderDaysBefore = Number(formData.get("reminderDaysBefore"));
  if (!Number.isFinite(reminderDaysBefore) || reminderDaysBefore < 0 || reminderDaysBefore > 6) {
    throw new Error("Kies een aantal dagen tussen 0 en 6.");
  }
  const notificationsEnabled = formData.get("notificationsEnabled") === "on";

  await prisma.picnicDeliveryPreference.upsert({
    where: { householdId },
    update: {
      preferredDayOfWeek: DAY_ENUM[dayKey],
      preferredTime,
      windowMinutes,
      reminderDaysBefore,
      notificationsEnabled,
    },
    create: {
      householdId,
      preferredDayOfWeek: DAY_ENUM[dayKey],
      preferredTime,
      windowMinutes,
      reminderDaysBefore,
      notificationsEnabled,
    },
  });

  redirectToOnsGezin("picnic-delivery-preference-updated");
}

export async function removePicnicDeliveryPreference(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  await prisma.picnicDeliveryPreference.deleteMany({ where: { householdId } });
  redirectToOnsGezin("picnic-delivery-preference-removed");
}
