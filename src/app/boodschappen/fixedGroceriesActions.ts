"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold } from "@/lib/auth";
import { matchProductForIngredient } from "@/domain/product-matching/matchIngredient";
import { upsertFixedGrocery, removeFixedGrocery } from "@/lib/fixedGroceries";
import { Unit } from "@/generated/prisma/enums";

function matchToLineFields(match: Awaited<ReturnType<typeof matchProductForIngredient>>) {
  return {
    productId: match.productId,
    needsReview: match.status !== "MATCHED_TRUSTED",
    matchStatus: match.status,
    matchConfidence: match.confidence,
    matchReasons: match.reasons,
  };
}

const VALID_UNITS = new Set(Object.values(Unit));

function parseQuantity(raw: FormDataEntryValue | null): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Vul een geldige hoeveelheid groter dan 0 in.");
  }
  return value;
}

function parseUnit(raw: FormDataEntryValue | null): Unit {
  const value = String(raw);
  if (!VALID_UNITS.has(value as Unit)) {
    throw new Error("Onbekende eenheid.");
  }
  return value as Unit;
}

/** Haalt householdId + product-kandidaten op via de regel, voor acties die alleen een lineId krijgen. */
async function loadFixedLine(lineId: string) {
  const line = await prisma.shoppingListLine.findUniqueOrThrow({
    where: { id: lineId },
    include: { shoppingList: { include: { mealPlan: { select: { householdId: true } } } } },
  });
  if (line.source !== "FIXED") {
    throw new Error("Deze actie is alleen bedoeld voor vaste boodschappen.");
  }
  await assertCurrentHousehold(line.shoppingList.mealPlan.householdId);
  return { line, householdId: line.shoppingList.mealPlan.householdId };
}

/** Zet een vaste boodschap voor déze week uit — de onderliggende standaard blijft ongewijzigd. */
export async function removeFixedLineThisWeek(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const { line } = await loadFixedLine(lineId);
  await prisma.shoppingListLine.delete({ where: { id: line.id } });
  revalidatePath("/boodschappen");
}

/** Zet een eerder deze-week-uitgeschakelde vaste boodschap weer aan. */
export async function restoreFixedLineThisWeek(formData: FormData) {
  const shoppingListId = String(formData.get("shoppingListId"));
  const ingredientId = String(formData.get("ingredientId"));

  const shoppingList = await prisma.shoppingList.findUniqueOrThrow({
    where: { id: shoppingListId },
    include: { mealPlan: { select: { householdId: true } } },
  });
  await assertCurrentHousehold(shoppingList.mealPlan.householdId);
  const fixed = await prisma.fixedGrocery.findUniqueOrThrow({
    where: { householdId_ingredientId: { householdId: shoppingList.mealPlan.householdId, ingredientId } },
  });

  const match = await matchProductForIngredient(shoppingList.mealPlan.householdId, ingredientId);

  await prisma.shoppingListLine.create({
    data: {
      shoppingListId,
      ingredientId,
      quantity: fixed.quantity,
      unit: fixed.unit,
      source: "FIXED",
      ...matchToLineFields(match),
    },
  });
  revalidatePath("/boodschappen");
}

/**
 * Past de hoeveelheid voor déze week aan. Alleen als `rememberAsDefault`
 * expliciet is aangevinkt, wordt dit ook de nieuwe standaard-hoeveelheid
 * (Fase 4: wijzigingen zijn standaard eenmalig, "onthouden" is een bewuste
 * keuze).
 */
export async function updateFixedLineQuantity(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const quantity = parseQuantity(formData.get("quantity"));
  const rememberAsDefault = formData.get("rememberAsDefault") === "true";

  const { line, householdId } = await loadFixedLine(lineId);
  await prisma.shoppingListLine.update({ where: { id: line.id }, data: { quantity } });

  if (rememberAsDefault) {
    await upsertFixedGrocery(householdId, line.ingredientId, quantity, line.unit);
  }
  revalidatePath("/boodschappen");
}

/** Voegt een nieuwe vaste boodschap toe aan de standaardlijst, en meteen aan de huidige lijst als die al bestaat. */
export async function addFixedGrocery(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const ingredientId = String(formData.get("ingredientId"));
  const quantity = parseQuantity(formData.get("quantity"));
  const unit = parseUnit(formData.get("unit"));
  const shoppingListId = formData.get("shoppingListId");

  await upsertFixedGrocery(householdId, ingredientId, quantity, unit);

  if (shoppingListId) {
    const match = await matchProductForIngredient(householdId, ingredientId);
    await prisma.shoppingListLine.create({
      data: {
        shoppingListId: String(shoppingListId),
        ingredientId,
        quantity,
        unit,
        source: "FIXED",
        ...matchToLineFields(match),
      },
    });
  }
  revalidatePath("/boodschappen");
}

/** Verwijdert een vaste boodschap definitief uit de standaardlijst (niet alleen deze week). */
export async function removeFixedGroceryPermanently(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const ingredientId = String(formData.get("ingredientId"));
  const lineId = formData.get("lineId");

  await removeFixedGrocery(householdId, ingredientId);
  if (lineId) {
    await prisma.shoppingListLine.deleteMany({ where: { id: String(lineId), source: "FIXED" } });
  }
  revalidatePath("/boodschappen");
}
