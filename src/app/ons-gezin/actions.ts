"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { DAY_KEYS, type DayKey } from "@/lib/week";

export async function addPerson(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "OTHER") as "PARENT" | "CHILD" | "OTHER";

  if (!name) {
    throw new Error("Naam is verplicht.");
  }

  await prisma.person.create({
    data: { householdId, name, role },
  });

  revalidatePath("/ons-gezin");
  revalidatePath("/");
}

export async function updateWeeklyRhythm(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  const dayKey = String(formData.get("dayKey")) as DayKey;
  const value = String(formData.get("value")) as "busy" | "quiet";

  if (!DAY_KEYS.includes(dayKey)) {
    throw new Error("Onbekende dag.");
  }

  const household = await prisma.household.findUniqueOrThrow({ where: { id: householdId } });
  const rhythm = (household.weeklyRhythm ?? {}) as Record<string, string>;

  await prisma.household.update({
    where: { id: householdId },
    data: { weeklyRhythm: { ...rhythm, [dayKey]: value } },
  });

  revalidatePath("/ons-gezin");
  revalidatePath("/");
}
