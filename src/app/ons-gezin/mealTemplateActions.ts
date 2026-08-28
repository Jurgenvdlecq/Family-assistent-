"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold } from "@/lib/auth";
import { Unit, MealComponentRole } from "@/generated/prisma/enums";

const VALID_UNITS = new Set(Object.values(Unit));
const VALID_ROLES = new Set(Object.values(MealComponentRole));

/** Volgorde waarin componenten in de naam van de maaltijd terechtkomen. */
const ROLE_ORDER: Record<string, number> = {
  BASE: 0,
  PROTEIN: 1,
  VEGETABLE: 2,
  SIDE: 3,
  SAUCE: 4,
  OTHER: 5,
};

function backToTemplates(status: string, unique: string): never {
  revalidatePath("/ons-gezin");
  revalidatePath("/week");
  revalidatePath("/boodschappen");
  // Iets unieks in de URL, anders slaat de router de navigatie naar dezelfde
  // pagina over en lijkt er niets gebeurd te zijn.
  redirect(`/ons-gezin?status=${encodeURIComponent(status)}&sjabloon=${encodeURIComponent(unique)}#maaltijdsjablonen`);
}

/** Controleert dat een sjabloon van dít huishouden is — nooit een id uit het formulier blind vertrouwen. */
async function assertOwnTemplate(householdId: string, mealTemplateId: string) {
  const template = await prisma.mealTemplate.findFirst({
    where: { id: mealTemplateId, householdId },
    select: { id: true },
  });
  if (!template) throw new Error("Onbekend maaltijdsjabloon.");
  return template;
}

export async function createMealTemplate(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) backToTemplates("template-name-missing", "nieuw");

  const existing = await prisma.mealTemplate.findFirst({ where: { householdId, name }, select: { id: true } });
  if (existing) backToTemplates("template-exists", existing.id);

  const template = await prisma.mealTemplate.create({ data: { householdId, name } });
  backToTemplates("template-created", template.id);
}

export async function deleteMealTemplate(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const mealTemplateId = String(formData.get("mealTemplateId"));
  await assertOwnTemplate(householdId, mealTemplateId);

  // Dagregels die hiernaar wijzen verliezen alleen het sjabloon; het
  // dagprofiel blijft staan, zodat die avond niet ineens ongeregeld is.
  await prisma.mealDayRule.updateMany({ where: { householdId, mealTemplateId }, data: { mealTemplateId: null } });
  await prisma.mealTemplate.delete({ where: { id: mealTemplateId } });
  backToTemplates("template-deleted", mealTemplateId);
}

/**
 * Voegt één optie toe aan een component ("Schnitzel" bij het vleescomponent).
 * Het component zelf wordt aangemaakt zodra het nodig is — één formulier in
 * plaats van eerst een groep en dan een optie.
 */
export async function addMealComponentOption(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const mealTemplateId = String(formData.get("mealTemplateId"));
  await assertOwnTemplate(householdId, mealTemplateId);

  const role = String(formData.get("role") ?? "");
  if (!VALID_ROLES.has(role as MealComponentRole)) throw new Error("Onbekend soort component.");
  const unit = String(formData.get("unit") ?? "");
  if (!VALID_UNITS.has(unit as Unit)) throw new Error("Onbekende eenheid.");

  const ingredientName = String(formData.get("ingredientName") ?? "").trim();
  const quantity = Number(String(formData.get("quantityPerPortion") ?? "").replace(",", "."));
  if (!ingredientName) backToTemplates("component-ingredient-missing", mealTemplateId);
  if (!Number.isFinite(quantity) || quantity <= 0) backToTemplates("component-quantity-invalid", mealTemplateId);

  // Bewust alleen bestaande ingrediënten: een nieuw ingrediënt aanmaken hoort
  // bij het zoeken van een echt Picnic-product (zoals bij vaste boodschappen),
  // niet bij het opschrijven van een maaltijdvorm. Anders ontstaat er een
  // ingrediënt waar nooit een product bij gevonden wordt.
  const ingredient = await prisma.ingredient.findFirst({
    where: { name: { equals: ingredientName, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!ingredient) backToTemplates("component-ingredient-unknown", mealTemplateId);

  const group = await prisma.mealComponentGroup.upsert({
    where: { mealTemplateId_role: { mealTemplateId, role: role as MealComponentRole } },
    create: {
      mealTemplateId,
      role: role as MealComponentRole,
      name: String(formData.get("groupName") ?? "").trim() || ingredient.name,
      sortOrder: ROLE_ORDER[role] ?? 9,
    },
    update: {},
  });

  await prisma.mealComponentOption.create({
    data: {
      mealComponentGroupId: group.id,
      name: String(formData.get("optionName") ?? "").trim() || ingredient.name,
      ingredientId: ingredient.id,
      quantityPerPortion: quantity,
      unit: unit as Unit,
    },
  });

  backToTemplates("component-added", `${mealTemplateId}-${group.id}`);
}

export async function removeMealComponentOption(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const optionId = String(formData.get("optionId"));

  // Via het sjabloon terug naar het huishouden — zo kan een id uit het
  // formulier nooit een optie van iemand anders raken.
  const option = await prisma.mealComponentOption.findFirst({
    where: { id: optionId, group: { mealTemplate: { householdId } } },
    select: { id: true, mealComponentGroupId: true, group: { select: { mealTemplateId: true } } },
  });
  if (!option) throw new Error("Onbekende optie.");

  await prisma.mealComponentOption.delete({ where: { id: option.id } });
  // Een component zonder opties heeft geen betekenis meer; laten staan zou een
  // lege keuze in de planner opleveren.
  const remaining = await prisma.mealComponentOption.count({
    where: { mealComponentGroupId: option.mealComponentGroupId },
  });
  if (remaining === 0) {
    await prisma.mealComponentGroup.delete({ where: { id: option.mealComponentGroupId } });
  }

  backToTemplates("component-removed", option.id);
}
