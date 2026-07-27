"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold, clearHouseholdSession, setHouseholdAccessCode } from "@/lib/auth";
import { defaultPortionMultiplierForRole } from "@/domain/household/presence";
import { DAY_ENUM, DAY_KEYS, getCurrentWeekStart, type DayKey } from "@/lib/week";

const ROLES = ["PARENT", "CHILD", "OTHER"] as const;
const STANCES = ["LIKED", "SOMETIMES", "RATHER_NOT", "NEVER", "UNKNOWN"] as const;

function parseRole(value: FormDataEntryValue | null): (typeof ROLES)[number] {
  const role = String(value ?? "OTHER");
  return ROLES.includes(role as (typeof ROLES)[number]) ? (role as (typeof ROLES)[number]) : "OTHER";
}

function parseStance(value: FormDataEntryValue | null): (typeof STANCES)[number] {
  const stance = String(value ?? "UNKNOWN");
  return STANCES.includes(stance as (typeof STANCES)[number])
    ? (stance as (typeof STANCES)[number])
    : "UNKNOWN";
}

function parseHardRestrictions(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function invalidateCurrentShoppingList(householdId: string) {
  const mealPlan = await prisma.mealPlan.findUnique({
    where: { householdId_weekStart: { householdId, weekStart: getCurrentWeekStart() } },
    select: { id: true },
  });
  if (!mealPlan) return;
  await prisma.shoppingList.deleteMany({ where: { mealPlanId: mealPlan.id } });
}

export async function addPerson(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const name = String(formData.get("name") ?? "").trim();
  const role = parseRole(formData.get("role"));

  if (!name) {
    throw new Error("Naam is verplicht.");
  }

  await prisma.person.create({
    data: { householdId, name, role, portionMultiplier: defaultPortionMultiplierForRole(role) },
  });

  revalidatePath("/ons-gezin");
  revalidatePath("/");
}

export async function updatePersonProfile(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const personId = String(formData.get("personId"));
  const role = parseRole(formData.get("role"));
  const portionMultiplier = Number(formData.get("portionMultiplier"));

  if (!Number.isFinite(portionMultiplier) || portionMultiplier <= 0 || portionMultiplier > 4) {
    throw new Error("Portiegrootte moet tussen 0 en 4 liggen.");
  }

  await prisma.person.update({
    where: { id: personId, householdId },
    data: {
      role,
      defaultPresent: formData.get("defaultPresent") === "on",
      portionMultiplier,
      hardRestrictions: parseHardRestrictions(formData.get("hardRestrictions")),
    },
  });

  await invalidateCurrentShoppingList(householdId);
  revalidatePath("/ons-gezin");
  revalidatePath("/");
  revalidatePath("/gerechten");
  revalidatePath("/boodschappen");
}

export async function updatePersonPresence(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const personId = String(formData.get("personId"));
  const dayKey = String(formData.get("dayKey")) as DayKey;
  const present = String(formData.get("present")) === "true";

  if (!DAY_KEYS.includes(dayKey)) {
    throw new Error("Onbekende dag.");
  }

  const person = await prisma.person.findUniqueOrThrow({
    where: { id: personId, householdId },
    select: { defaultPresent: true },
  });

  if (present === person.defaultPresent) {
    await prisma.personPresenceOverride.deleteMany({
      where: { personId, dayOfWeek: DAY_ENUM[dayKey] },
    });
  } else {
    await prisma.personPresenceOverride.upsert({
      where: { personId_dayOfWeek: { personId, dayOfWeek: DAY_ENUM[dayKey] } },
      create: { personId, dayOfWeek: DAY_ENUM[dayKey], present },
      update: { present },
    });
  }

  await invalidateCurrentShoppingList(householdId);
  revalidatePath("/ons-gezin");
  revalidatePath("/");
  revalidatePath("/gerechten");
  revalidatePath("/boodschappen");
}

export async function updateWeeklyRhythm(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
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

async function loadPersonalPreferenceForCurrentHousehold(preferenceId: string, householdId: string) {
  const preference = await prisma.preference.findUniqueOrThrow({ where: { id: preferenceId } });
  if (preference.ownerType !== "PERSON") {
    throw new Error("Alleen persoonlijke voorkeuren kunnen hier worden aangepast.");
  }
  await prisma.person.findUniqueOrThrow({
    where: { id: preference.ownerId, householdId },
    select: { id: true },
  });
  return preference;
}

export async function updatePersonalPreference(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const preferenceId = String(formData.get("preferenceId"));
  const stance = parseStance(formData.get("stance"));

  await loadPersonalPreferenceForCurrentHousehold(preferenceId, householdId);
  await prisma.preference.update({
    where: { id: preferenceId },
    data: { stance, source: "EXPLICIT", confidence: stance === "UNKNOWN" ? 0 : 1 },
  });

  revalidatePath("/ons-gezin");
  revalidatePath("/");
  revalidatePath("/gerechten");
}

export async function deletePersonalPreference(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const preferenceId = String(formData.get("preferenceId"));

  await loadPersonalPreferenceForCurrentHousehold(preferenceId, householdId);
  await prisma.preference.delete({ where: { id: preferenceId } });

  revalidatePath("/ons-gezin");
  revalidatePath("/");
  revalidatePath("/gerechten");
}

export async function updateAccessCode(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const accessCode = String(formData.get("accessCode") ?? "");
  await setHouseholdAccessCode(householdId, accessCode);
  revalidatePath("/ons-gezin");
}

export async function logout() {
  await clearHouseholdSession();
  redirect("/login");
}
