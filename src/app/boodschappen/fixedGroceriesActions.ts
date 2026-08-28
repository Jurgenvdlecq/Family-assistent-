"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold } from "@/lib/auth";
import { matchProductForIngredient } from "@/domain/product-matching/matchIngredient";
import { recordProductChosen } from "@/domain/product-matching/repository";
import { upsertFixedGrocery, removeFixedGrocery } from "@/lib/fixedGroceries";
import { Unit } from "@/generated/prisma/enums";
import { removeBulkFixedGroceryLine } from "@/lib/fixedGroceryProductChoice";
import { resolvePicnicProductChoice } from "@/lib/picnicProductChoice";
import { assertShoppingListAccess } from "@/lib/shoppingListAccess";

interface FixedPicnicProductInput {
  householdId: string;
  shoppingListId: string;
  searchTerm: string;
  productName: string;
  externalRef: string;
  packageSize: string | null;
  picnicImageId: string | null;
  quantity: number;
  unit: Unit;
  price: number | null;
}

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

function parseBulkChoice(raw: FormDataEntryValue): FixedPicnicProductInput {
  const data = JSON.parse(String(raw)) as Record<string, unknown>;
  return {
    householdId: String(data.householdId ?? ""),
    shoppingListId: String(data.shoppingListId ?? ""),
    searchTerm: String(data.searchTerm ?? "").trim(),
    productName: String(data.productName ?? "").trim(),
    externalRef: String(data.externalRef ?? "").trim(),
    packageSize: String(data.packageSize ?? "").trim() || null,
    picnicImageId: String(data.picnicImageId ?? "").trim() || null,
    quantity: Number(data.quantity),
    unit: parseUnit(String(data.unit ?? "")),
    price: data.price == null || data.price === "" ? null : Number(data.price),
  };
}

/**
 * `unique` is geen sier: zonder iets wat per actie verschilt komt de redirect
 * op exact dezelfde URL uit als de pagina waar de gebruiker al staat, en dan
 * slaat de router de navigatie over — de wijziging staat wél in de database,
 * maar niet op het scherm.
 */
function redirectToFixedGroceries(status: string, unique?: string): never {
  revalidatePath("/boodschappen");
  const params = new URLSearchParams({ status });
  if (unique) params.set("regel", unique);
  redirect(`/boodschappen?${params.toString()}#fixed-groceries`);
}

function redirectToFixedLine(lineId: string, status: string): never {
  revalidatePath("/boodschappen");
  revalidatePath("/controle");
  redirect(
    `/boodschappen?fixedLine=${encodeURIComponent(lineId)}&status=${encodeURIComponent(
      status
    )}#fixed-line-${encodeURIComponent(lineId)}`
  );
}

async function saveFixedPicnicProduct(input: FixedPicnicProductInput) {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("Vul een geldige hoeveelheid groter dan 0 in.");
  }

  const { ingredient, product } = await resolvePicnicProductChoice(input);

  await upsertFixedGrocery(input.householdId, ingredient.id, input.quantity, input.unit);
  await recordProductChosen(input.householdId, ingredient.id, product.id, "MANUAL");

  const lineData = {
    ingredientId: ingredient.id,
    productId: product.id,
    quantity: input.quantity,
    unit: input.unit,
    source: "FIXED" as const,
    needsReview: false,
    matchStatus: "MANUALLY_SELECTED" as const,
    matchConfidence: 1,
    matchReasons: ["Handmatig als vaste boodschap gekozen en onthouden."],
  };

  const existingLine = await prisma.shoppingListLine.findFirst({
    where: { shoppingListId: input.shoppingListId, ingredientId: ingredient.id, source: "FIXED" },
    select: { id: true },
  });
  if (existingLine) {
    await prisma.shoppingListLine.update({ where: { id: existingLine.id }, data: lineData });
    return existingLine.id;
  }
  const line = await prisma.shoppingListLine.create({
    data: { shoppingListId: input.shoppingListId, ...lineData },
    select: { id: true },
  });
  return line.id;
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
  redirectToFixedGroceries("fixed-disabled", line.id);
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

  const line = await prisma.shoppingListLine.create({
    data: {
      shoppingListId,
      ingredientId,
      quantity: fixed.quantity,
      unit: fixed.unit,
      source: "FIXED",
      ...matchToLineFields(match),
    },
    select: { id: true },
  });
  redirectToFixedLine(line.id, "fixed-restored");
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
  const unit = formData.get("unit") ? parseUnit(formData.get("unit")) : null;
  const rememberAsDefault = formData.get("rememberAsDefault") === "true";

  const { line, householdId } = await loadFixedLine(lineId);
  const targetUnit = unit ?? line.unit;
  await prisma.shoppingListLine.update({ where: { id: line.id }, data: { quantity, unit: targetUnit } });

  if (rememberAsDefault) {
    await upsertFixedGrocery(householdId, line.ingredientId, quantity, targetUnit);
  }
  redirectToFixedLine(line.id, rememberAsDefault ? "fixed-quantity-remembered" : "fixed-quantity");
}

/** Voegt een nieuwe vaste boodschap toe aan de standaardlijst, en meteen aan de huidige lijst als die al bestaat. */
export async function addFixedGrocery(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const ingredientId = String(formData.get("ingredientId"));
  const quantity = parseQuantity(formData.get("quantity"));
  const unit = parseUnit(formData.get("unit"));
  const shoppingListId = formData.get("shoppingListId");

  // shoppingListId komt los uit het formulier mee — assertCurrentHousehold
  // hierboven bewijst alleen dát het meegestuurde householdId bij de eigen
  // sessie hoort, niet dat déze shoppingListId ook echt bij dat huishouden
  // hoort (zelfde reden als bij addFixedPicnicProduct/addBulkFixedPicnicProducts
  // hieronder). Deze check staat bewust vóór upsertFixedGrocery: bij een
  // ongeldige shoppingListId wordt zo helemaal niets geschreven, ook niet de
  // vaste-boodschap-standaard zelf — geen transactie nodig, want er is op dat
  // moment nog geen enkele write geweest.
  if (shoppingListId) {
    await assertShoppingListAccess(String(shoppingListId));
  }

  await upsertFixedGrocery(householdId, ingredientId, quantity, unit);

  if (shoppingListId) {
    const match = await matchProductForIngredient(householdId, ingredientId);
    const line = await prisma.shoppingListLine.create({
      data: {
        shoppingListId: String(shoppingListId),
        ingredientId,
        quantity,
        unit,
        source: "FIXED",
        ...matchToLineFields(match),
      },
      select: { id: true },
    });
    redirectToFixedLine(line.id, "fixed-added");
  }
  redirectToFixedGroceries("fixed-added");
}

export async function addFixedPicnicProduct(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);

  const shoppingListId = String(formData.get("shoppingListId") ?? "");
  const replaceLineId = String(formData.get("replaceLineId") ?? "").trim();
  const searchTerm = String(formData.get("searchTerm") ?? "").trim();
  const productName = String(formData.get("productName") ?? "").trim();
  const externalRef = String(formData.get("externalRef") ?? "").trim();
  const packageSize = String(formData.get("packageSize") ?? "").trim() || null;
  const picnicImageId = String(formData.get("picnicImageId") ?? "").trim() || null;
  const bulkFixed = String(formData.get("bulkFixed") ?? "").trim();
  const bulkFixedRaw = String(formData.get("bulkFixedRaw") ?? "").trim();
  const quantity = parseQuantity(formData.get("quantity"));
  const unit = parseUnit(formData.get("unit"));
  const price = parseOptionalPrice(formData.get("price"));

  if (!productName || !externalRef) {
    throw new Error("Kies een geldig Picnic-product.");
  }
  // shoppingListId komt los uit het formulier mee — assertCurrentHousehold
  // hierboven bewijst alleen dát het meegestuurde householdId bij de eigen
  // sessie hoort, niet dat déze shoppingListId ook echt bij dat huishouden
  // hoort. Zonder deze check zou een geldige sessie een shoppingListId van
  // een ander huishouden kunnen meesturen.
  if (shoppingListId) {
    await assertShoppingListAccess(shoppingListId);
  }

  const replacement = replaceLineId ? await loadFixedLine(replaceLineId) : null;
  if (replacement && replacement.householdId !== householdId) {
    throw new Error("Deze vaste boodschap hoort niet bij dit huishouden.");
  }

  const input = {
    householdId,
    shoppingListId,
    searchTerm,
    productName,
    externalRef,
    packageSize,
    picnicImageId,
    quantity,
    unit,
    price,
  };

  if (replacement) {
    const previousIngredientId = replacement.line.ingredientId;
    const lineId = await saveFixedPicnicProduct({
      ...input,
      shoppingListId: replacement.line.shoppingListId,
    });
    const targetShoppingListId = replacement.line.shoppingListId;
    const savedLine = await prisma.shoppingListLine.findUniqueOrThrow({ where: { id: lineId } });
    if (previousIngredientId !== savedLine.ingredientId) {
      await removeFixedGrocery(householdId, previousIngredientId);
      await prisma.shoppingListLine.deleteMany({
        where: {
          shoppingListId: targetShoppingListId,
          ingredientId: savedLine.ingredientId,
          source: "FIXED",
          NOT: { id: replacement.line.id },
        },
      });
    }

    await prisma.shoppingListLine.update({
      where: { id: replacement.line.id },
      data: {
        ingredientId: savedLine.ingredientId,
        productId: savedLine.productId,
        quantity: savedLine.quantity,
        unit: savedLine.unit,
        source: "FIXED",
        needsReview: false,
        matchStatus: "MANUALLY_SELECTED",
        matchConfidence: 1,
        matchReasons: ["Handmatig als vaste boodschap gekozen en onthouden."],
      },
    });
    if (lineId !== replacement.line.id) {
      await prisma.shoppingListLine.delete({ where: { id: lineId } });
    }

    redirectToFixedLine(replacement.line.id, "fixed-replaced");
  }

  if (shoppingListId) {
    const lineId = await saveFixedPicnicProduct(input);

    revalidatePath("/boodschappen");
    revalidatePath("/controle");
    if (bulkFixed) {
      const remainingBulkFixed = bulkFixedRaw ? removeBulkFixedGroceryLine(bulkFixed, bulkFixedRaw) : bulkFixed;
      if (remainingBulkFixed) {
        const params = new URLSearchParams({ bulkFixed: remainingBulkFixed, fixedLine: lineId, status: "fixed-added" });
        redirect(`/boodschappen?${params.toString()}#bulk-fixed-groceries`);
      }
    }
    redirectToFixedLine(lineId, "fixed-added");
  }

  redirectToFixedGroceries("fixed-added");
}

export async function addBulkFixedPicnicProducts(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);

  const choices = formData.getAll("choice").map(parseBulkChoice);
  const validChoices = choices.filter((choice) => choice.householdId === householdId && choice.productName && choice.externalRef);
  if (validChoices.length === 0) {
    throw new Error("Ik kon geen geldige producten opslaan.");
  }

  // Zelfde reden als in addFixedPicnicProduct: elke unieke shoppingListId
  // los verifiëren tegen het huidige huishouden vóórdat er iets in
  // geschreven wordt.
  const verifiedShoppingListIds = new Set<string>();
  for (const choice of validChoices) {
    if (!verifiedShoppingListIds.has(choice.shoppingListId)) {
      await assertShoppingListAccess(choice.shoppingListId);
      verifiedShoppingListIds.add(choice.shoppingListId);
    }
  }

  let firstLineId: string | null = null;
  for (const choice of validChoices) {
    const lineId = await saveFixedPicnicProduct(choice);
    firstLineId ??= lineId;
  }

  revalidatePath("/boodschappen");
  revalidatePath("/controle");
  if (firstLineId) redirectToFixedLine(firstLineId, "fixed-bulk-added");
  redirectToFixedGroceries("fixed-bulk-added");
}

/** Verwijdert een vaste boodschap definitief uit de standaardlijst (niet alleen deze week). */
export async function removeFixedGroceryPermanently(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const ingredientId = String(formData.get("ingredientId"));
  const lineId = formData.get("lineId");

  // lineId komt los uit het formulier mee — controleer via de bestaande
  // shoppingList->mealPlan-keten (loadFixedLine, ook gebruikt door
  // removeFixedLineThisWeek/updateFixedLineQuantity hierboven) dat de regel
  // écht bij dit huishouden hoort en een FIXED-regel is, vóórdat er iets
  // verwijderd wordt. Zonder deze check zou een geldige sessie een lineId
  // van een ander huishouden kunnen meesturen en zo een regel bij dat andere
  // huishouden kunnen verwijderen. Staat bewust vóór de transactie hieronder
  // — bij een ongeldige lineId wordt dan ook de vaste-boodschap-standaard
  // zelf niet verwijderd.
  if (lineId) {
    await loadFixedLine(String(lineId));
  }

  await prisma.$transaction([
    prisma.fixedGrocery.deleteMany({ where: { householdId, ingredientId } }),
    ...(lineId ? [prisma.shoppingListLine.deleteMany({ where: { id: String(lineId), source: "FIXED" } })] : []),
  ]);
  // Deze actie is sinds de optiemenu's ook vanaf de boodschappenlijst zelf
  // aan te roepen ("Nooit meer"). Dan hoort de gebruiker terug te komen bij
  // die lijst, niet in het beheerblok waar hij niet was. Vaste, gesloten
  // keuze uit twee bekende bestemmingen — geen pad uit het formulier.
  if (String(formData.get("returnTo") ?? "") === "list") {
    revalidatePath("/boodschappen");
    redirect("/boodschappen?status=fixed-removed-from-list#jullie-boodschappenlijst");
  }
  redirectToFixedGroceries("fixed-removed");
}
