"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold } from "@/lib/auth";
import { matchProductForIngredient } from "@/domain/product-matching/matchIngredient";
import { recordProductChosen } from "@/domain/product-matching/repository";
import { upsertFixedGrocery, removeFixedGrocery } from "@/lib/fixedGroceries";
import { Unit } from "@/generated/prisma/enums";
import { inferFixedGroceryQuantity, inferIngredientCategory, titleCaseSearchTerm } from "@/lib/fixedGroceryProductChoice";
import { parsePackageQuantity } from "@/lib/quantity/parsePackageSize";

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

function parseOptionalPrice(raw: FormDataEntryValue | null) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const parsed = Number(value.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
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

export async function addFixedPicnicProduct(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);

  const shoppingListId = String(formData.get("shoppingListId") ?? "");
  const searchTerm = String(formData.get("searchTerm") ?? "").trim();
  const productName = String(formData.get("productName") ?? "").trim();
  const externalRef = String(formData.get("externalRef") ?? "").trim();
  const packageSize = String(formData.get("packageSize") ?? "").trim() || null;
  const picnicImageId = String(formData.get("picnicImageId") ?? "").trim() || null;
  const quantity = parseQuantity(formData.get("quantity"));
  const unit = parseUnit(formData.get("unit"));
  const price = parseOptionalPrice(formData.get("price"));

  if (!productName || !externalRef) {
    throw new Error("Kies een geldig Picnic-product.");
  }

  const ingredientName = titleCaseSearchTerm(searchTerm || productName);
  const inferred = inferFixedGroceryQuantity(packageSize);
  const existingIngredient = await prisma.ingredient.findUnique({ where: { name: ingredientName } });
  const ingredient =
    existingIngredient ??
    (await prisma.ingredient.create({
      data: {
        name: ingredientName,
        unit: inferred.unit,
        category: inferIngredientCategory(ingredientName),
      },
    }));

  const productData = {
    ingredientId: ingredient.id,
    externalRef,
    picnicImageId,
    name: productName,
    packageSize,
    packageQuantity: packageSize ? parsePackageQuantity(packageSize, ingredient.unit) : null,
    price,
    lastSeenAvailable: new Date(),
  };
  const existingProduct = await prisma.product.findFirst({
    where: { ingredientId: ingredient.id, externalRef },
    select: { id: true },
  });
  const product = existingProduct
    ? await prisma.product.update({ where: { id: existingProduct.id }, data: productData })
    : await prisma.product.create({ data: productData });

  await upsertFixedGrocery(householdId, ingredient.id, quantity, unit);
  await recordProductChosen(householdId, ingredient.id, product.id, "MANUAL");

  if (shoppingListId) {
    const existingLine = await prisma.shoppingListLine.findFirst({
      where: { shoppingListId, ingredientId: ingredient.id, source: "FIXED" },
      select: { id: true },
    });
    const lineData = {
      ingredientId: ingredient.id,
      productId: product.id,
      quantity,
      unit,
      source: "FIXED" as const,
      needsReview: false,
      matchStatus: "MANUALLY_SELECTED" as const,
      matchConfidence: 1,
      matchReasons: ["Handmatig als vaste boodschap gekozen en onthouden."],
    };
    let lineId: string | null = null;
    if (existingLine) {
      await prisma.shoppingListLine.update({ where: { id: existingLine.id }, data: lineData });
      lineId = existingLine.id;
    } else {
      const line = await prisma.shoppingListLine.create({
        data: { shoppingListId, ...lineData },
        select: { id: true },
      });
      lineId = line.id;
    }

    revalidatePath("/boodschappen");
    revalidatePath("/controle");
    redirect(`/boodschappen?fixedLine=${encodeURIComponent(lineId)}#fixed-line-${encodeURIComponent(lineId)}`);
  }

  revalidatePath("/boodschappen");
  revalidatePath("/controle");
  redirect("/boodschappen#add-fixed-grocery");
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
