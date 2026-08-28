"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold, clearHouseholdSession, setHouseholdCredentials } from "@/lib/auth";
import { defaultPortionMultiplierForRole } from "@/domain/household/presence";
import { normalizeProductChoicePreference } from "@/domain/product-matching/productChoicePreference";
import { RecipeCategory } from "@/generated/prisma/enums";
import { DAY_ENUM, DAY_KEYS, getCurrentWeekStart, type DayKey } from "@/lib/week";
import {
  dayRecipePreferenceOwnerId,
  isDayRecipePreferenceStance,
} from "@/domain/meal-planning/dayRecipePreferences";
import { accessibleRecipeWhere } from "@/lib/recipeScope";
import { invalidateShoppingList } from "@/lib/shoppingList";

const ROLES = ["PARENT", "CHILD", "OTHER"] as const;
const STANCES = ["LIKED", "SOMETIMES", "RATHER_NOT", "NEVER", "UNKNOWN"] as const;
const RECIPE_CATEGORIES = new Set(Object.values(RecipeCategory));

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

/**
 * `revalidatePath` alleen is niet genoeg om de gebruiker te laten zien dat
 * een actie is gelukt: zonder een echte navigatie bleef deze pagina soms de
 * oude staat tonen. Een redirect terug naar /ons-gezin dwingt een verse
 * render af én toont een expliciete groene bevestiging — dezelfde aanpak
 * als /boodschappen, /recepten en de homepage.
 */
function redirectToOnsGezin(status: string): never {
  revalidatePath("/ons-gezin");
  redirect(`/ons-gezin?status=${encodeURIComponent(status)}`);
}

async function invalidateCurrentShoppingList(householdId: string) {
  const mealPlan = await prisma.mealPlan.findUnique({
    where: { householdId_weekStart: { householdId, weekStart: getCurrentWeekStart() } },
    select: { id: true },
  });
  if (!mealPlan) return;
  // Via invalidateShoppingList i.p.v. een eigen deleteMany: die bewaart
  // regels die al naar het Picnic-mandje zijn overgedragen, zodat ze niet
  // dubbel besteld worden (zie de toelichting daar).
  await invalidateShoppingList(mealPlan.id);
}

/**
 * Huishoudbrede harde regel (MEAL_PLANNING_GAP_PLAN.md, wens 2: "geen vis"),
 * los van een individuele allergie op een gezinslid — geldt voor iedereen,
 * ongeacht wie er die dag mee-eet. Zelfde gecontroleerde vocabulaire en
 * invoerpatroon als een persoonlijke harde beperking (parseHardRestrictions),
 * alleen op een ander model.
 */
export async function updateHouseholdHardRestrictions(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);

  await prisma.household.update({
    where: { id: householdId },
    data: { hardRestrictions: parseHardRestrictions(formData.get("hardRestrictions")) },
  });

  await invalidateCurrentShoppingList(householdId);
  revalidatePath("/week");
  revalidatePath("/gerechten");
  revalidatePath("/boodschappen");
  redirectToOnsGezin("household-restrictions-updated");
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

  revalidatePath("/week");
  redirectToOnsGezin("person-added");
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
  revalidatePath("/week");
  revalidatePath("/gerechten");
  revalidatePath("/boodschappen");
  redirectToOnsGezin("person-updated");
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
  revalidatePath("/week");
  revalidatePath("/gerechten");
  revalidatePath("/boodschappen");
  redirectToOnsGezin("presence-updated");
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

  revalidatePath("/week");
  redirectToOnsGezin("rhythm-updated");
}

const PLANNING_STYLES = ["SAFE", "BALANCED", "ADVENTUROUS"] as const;

/**
 * Fase 10: "voorkeur voor herhaalbare gerechten" bestond al als
 * `Household.planningStyle` (SAFE = vaker bewezen/herhaalde gerechten,
 * ADVENTUROUS = meer nieuwe suggesties — zie scoreMealPlanCandidate.ts),
 * maar kon tot nu toe alleen bij onboarding gezet worden. Een huishouden
 * verandert hier over tijd in, dus dit hoort net als de andere voorkeuren
 * op deze pagina aanpasbaar te zijn.
 */
export async function updatePlanningStyle(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const planningStyle = String(formData.get("planningStyle"));

  if (!PLANNING_STYLES.includes(planningStyle as (typeof PLANNING_STYLES)[number])) {
    throw new Error("Onbekende planningsstijl.");
  }

  await prisma.household.update({
    where: { id: householdId },
    data: { planningStyle: planningStyle as (typeof PLANNING_STYLES)[number] },
  });

  revalidatePath("/week");
  redirectToOnsGezin("planning-style-updated");
}

export async function updateProductChoicePreference(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const productChoicePreference = normalizeProductChoicePreference(formData.get("productChoicePreference"));

  const household = await prisma.household.findUniqueOrThrow({
    where: { id: householdId },
    select: { deliveryPreference: true },
  });
  const deliveryPreference =
    typeof household.deliveryPreference === "object" && household.deliveryPreference !== null
      ? (household.deliveryPreference as Record<string, unknown>)
      : {};

  await prisma.household.update({
    where: { id: householdId },
    data: { deliveryPreference: { ...deliveryPreference, productChoicePreference } },
  });

  await invalidateCurrentShoppingList(householdId);
  revalidatePath("/boodschappen");
  revalidatePath("/controle");
  redirectToOnsGezin("product-preference-updated");
}

export async function updateHouseholdCategoryPreference(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const category = String(formData.get("category"));
  const stance = parseStance(formData.get("stance"));

  if (!RECIPE_CATEGORIES.has(category as RecipeCategory)) {
    throw new Error("Onbekende maaltijdsoort.");
  }

  if (stance === "UNKNOWN") {
    await prisma.preference.deleteMany({
      where: {
        ownerType: "HOUSEHOLD",
        ownerId: householdId,
        subjectType: "RECIPE_CATEGORY",
        subjectId: category,
      },
    });
  } else {
    await prisma.preference.upsert({
      where: {
        ownerType_ownerId_subjectType_subjectId: {
          ownerType: "HOUSEHOLD",
          ownerId: householdId,
          subjectType: "RECIPE_CATEGORY",
          subjectId: category,
        },
      },
      update: { stance, source: "EXPLICIT", confidence: 1 },
      create: {
        ownerType: "HOUSEHOLD",
        ownerId: householdId,
        subjectType: "RECIPE_CATEGORY",
        subjectId: category,
        stance,
        source: "EXPLICIT",
        confidence: 1,
      },
    });
  }

  revalidatePath("/week");
  revalidatePath("/gerechten");
  redirectToOnsGezin("category-preference-updated");
}

export async function setDayRecipePreference(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const dayKey = String(formData.get("dayKey")) as DayKey;
  const recipeVariantId = String(formData.get("recipeVariantId"));
  const stance = String(formData.get("stance") ?? "LIKED");

  if (!DAY_KEYS.includes(dayKey)) {
    throw new Error("Onbekende dag.");
  }
  if (!isDayRecipePreferenceStance(stance)) {
    throw new Error("Onbekende dagvoorkeur.");
  }

  await prisma.recipeVariant.findUniqueOrThrow({
    where: { id: recipeVariantId, recipe: accessibleRecipeWhere(householdId) },
    select: { id: true },
  });

  await prisma.preference.upsert({
    where: {
      ownerType_ownerId_subjectType_subjectId: {
        ownerType: "HOUSEHOLD",
        ownerId: dayRecipePreferenceOwnerId(householdId, dayKey),
        subjectType: "RECIPE_VARIANT",
        subjectId: recipeVariantId,
      },
    },
    update: { stance, source: "EXPLICIT", confidence: 1 },
    create: {
      ownerType: "HOUSEHOLD",
      ownerId: dayRecipePreferenceOwnerId(householdId, dayKey),
      subjectType: "RECIPE_VARIANT",
      subjectId: recipeVariantId,
      stance,
      source: "EXPLICIT",
      confidence: 1,
    },
  });

  revalidatePath("/week");
  revalidatePath("/gerechten");
  redirectToOnsGezin("day-recipe-preference-updated");
}

export async function deleteDayRecipePreference(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const dayKey = String(formData.get("dayKey")) as DayKey;
  const recipeVariantId = String(formData.get("recipeVariantId"));

  if (!DAY_KEYS.includes(dayKey)) {
    throw new Error("Onbekende dag.");
  }

  await prisma.preference.deleteMany({
    where: {
      ownerType: "HOUSEHOLD",
      ownerId: dayRecipePreferenceOwnerId(householdId, dayKey),
      subjectType: "RECIPE_VARIANT",
      subjectId: recipeVariantId,
    },
  });

  revalidatePath("/week");
  revalidatePath("/gerechten");
  redirectToOnsGezin("day-recipe-preference-deleted");
}

export async function forgetProductPreference(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const preferenceId = String(formData.get("preferenceId"));

  await prisma.householdProductPreference.deleteMany({ where: { id: preferenceId, householdId } });

  await invalidateCurrentShoppingList(householdId);
  revalidatePath("/boodschappen");
  revalidatePath("/controle");
  redirectToOnsGezin("product-preference-forgotten");
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

  revalidatePath("/week");
  revalidatePath("/gerechten");
  redirectToOnsGezin("personal-preference-updated");
}

export async function deletePersonalPreference(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const preferenceId = String(formData.get("preferenceId"));

  await loadPersonalPreferenceForCurrentHousehold(preferenceId, householdId);
  await prisma.preference.delete({ where: { id: preferenceId } });

  revalidatePath("/week");
  revalidatePath("/gerechten");
  redirectToOnsGezin("personal-preference-deleted");
}

export async function updateCredentials(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");

  try {
    await setHouseholdCredentials(householdId, username, password);
  } catch (error) {
    // Redirecten met een statuscode i.p.v. de fout laten doorborrelen: een
    // geworpen Error uit een server-actie wordt in productiebuilds
    // gereduceerd tot een generiek bericht (zie de toelichting bij
    // completeOnboarding in src/app/onboarding/actions.ts), dus alleen zo
    // ziet de gebruiker daadwerkelijk waarom het opslaan mislukte.
    const message = error instanceof Error ? error.message : "";
    redirectToOnsGezin(message.includes("in gebruik") ? "username-taken" : "credentials-invalid");
  }

  redirectToOnsGezin("credentials-updated");
}

export async function logout() {
  await clearHouseholdSession();
  redirect("/login");
}
