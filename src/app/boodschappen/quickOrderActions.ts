"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold } from "@/lib/auth";
import { recordProductChosen } from "@/domain/product-matching/repository";
import { resolvePicnicProductChoice } from "@/lib/picnicProductChoice";
import { removeBulkFixedGroceryLine } from "@/lib/fixedGroceryProductChoice";
import { assertShoppingListAccess } from "@/lib/shoppingListAccess";
import { Unit } from "@/generated/prisma/enums";

const VALID_UNITS = new Set(Object.values(Unit));

function parseUnit(raw: FormDataEntryValue | null): Unit {
  const value = String(raw);
  if (!VALID_UNITS.has(value as Unit)) {
    throw new Error("Onbekende eenheid.");
  }
  return value as Unit;
}

interface QuickOrderChoiceInput {
  householdId: string;
  shoppingListId: string;
  /** Ruwe brontekst van deze regel (bv. "2 bloemkool") — alleen nodig om 'm na opslaan uit de resterende batchtekst te strepen. */
  raw: string;
  searchTerm: string;
  productName: string;
  externalRef: string;
  packageSize: string | null;
  picnicImageId: string | null;
  quantity: number;
  unit: Unit;
  price: number | null;
}

function parseQuickOrderChoice(raw: FormDataEntryValue): QuickOrderChoiceInput {
  const data = JSON.parse(String(raw)) as Record<string, unknown>;
  return {
    householdId: String(data.householdId ?? ""),
    shoppingListId: String(data.shoppingListId ?? ""),
    raw: String(data.raw ?? "").trim(),
    searchTerm: String(data.searchTerm ?? "").trim(),
    productName: String(data.productName ?? "").trim(),
    externalRef: String(data.externalRef ?? "").trim(),
    packageSize: String(data.packageSize ?? "").trim() || null,
    picnicImageId: String(data.picnicImageId ?? "").trim() || null,
    quantity: Number(data.quantity ?? 1),
    unit: parseUnit(String(data.unit ?? "PIECE")),
    price: data.price == null || data.price === "" ? null : Number(data.price),
  };
}

type SaveQuickOrderLineInput = Omit<QuickOrderChoiceInput, "householdId" | "raw">;

async function saveQuickOrderLine(householdId: string, input: SaveQuickOrderLineInput, matchReason: string) {
  // Beide aanroepers ontvangen quantity/price via een hidden JSON-veld dat
  // vóór verzenden aan te passen is (devtools) — expliciet valideren zodat
  // geen NaN/negatieve hoeveelheid kan wegschrijven.
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("Vul een geldige hoeveelheid groter dan 0 in.");
  }
  if (input.price != null && !Number.isFinite(input.price)) {
    throw new Error("Ongeldige prijs.");
  }

  const { ingredient, product } = await resolvePicnicProductChoice(input);
  await recordProductChosen(householdId, ingredient.id, product.id);

  return prisma.shoppingListLine.create({
    data: {
      shoppingListId: input.shoppingListId,
      ingredientId: ingredient.id,
      productId: product.id,
      quantity: input.quantity,
      unit: input.unit,
      source: "MANUAL",
      needsReview: false,
      matchStatus: "MANUALLY_SELECTED",
      matchConfidence: 1,
      matchReasons: [matchReason],
    },
    select: { id: true },
  });
}

/**
 * Voegt in één keer alle producten toe die de gebruiker met de radioknoppen
 * heeft aangewezen voor de regels zonder vertrouwde eerdere keuze (elke
 * regel is een eigen radiogroep `choice-<index>`, dus per regel precies één
 * geselecteerd product). Vervangt het oude patroon van één "Toevoegen"-klik
 * per product (elk een aparte server-actie-aanroep, dus een paginaherlaad
 * per klik — gebruikersmelding: "dat duurt steeds 5 seconden, dat gaat
 * tegen het idee van de app in"). Regels zonder resultaat (geen radio's,
 * dus geen bijbehorende `choice-<index>` in het formulier) blijven na deze
 * actie gewoon zichtbaar om opnieuw te zoeken — dezelfde
 * resterende-batchtekst-truc als `addQuickOrderTrustedProducts`.
 */
export async function addQuickOrderPickedProducts(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);

  const choices = Array.from(formData.entries())
    .filter(([key]) => key.startsWith("choice-"))
    .map(([, value]) => parseQuickOrderChoice(value));
  const validChoices = choices.filter(
    (choice) => choice.householdId === householdId && choice.productName && choice.externalRef
  );

  if (validChoices.length > 0) {
    const verifiedShoppingListIds = new Set<string>();
    for (const choice of validChoices) {
      if (!verifiedShoppingListIds.has(choice.shoppingListId)) {
        await assertShoppingListAccess(choice.shoppingListId);
        verifiedShoppingListIds.add(choice.shoppingListId);
      }
    }

    for (const choice of validChoices) {
      await saveQuickOrderLine(householdId, choice, "Gekozen bij het snel samenstellen van de boodschappenlijst.");
    }

    revalidatePath("/boodschappen");
    revalidatePath("/controle");
  }

  let remainingQuickOrderText = String(formData.get("quickOrderText") ?? "").trim();
  for (const choice of validChoices) {
    if (choice.raw) remainingQuickOrderText = removeBulkFixedGroceryLine(remainingQuickOrderText, choice.raw);
  }

  if (remainingQuickOrderText) {
    const params = new URLSearchParams({ quickOrder: remainingQuickOrderText, status: "quick-order-added" });
    redirect(`/boodschappen?${params.toString()}#quick-order`);
  }
  redirect("/boodschappen?status=quick-order-added#quick-order");
}

/**
 * Voegt in één keer alle regels toe waarvoor jullie al eerder bewust een
 * Picnic-product hebben gekozen (MATCHED_TRUSTED) — dit is de kern van
 * "snel in de auto een lijst maken": de gebruiker hoeft niet voor elk
 * bekend product opnieuw door zoekresultaten te bladeren. Onbekende of
 * twijfelachtige ingrediënten komen hier bewust niet doorheen (die lopen
 * via addQuickOrderPickedProducts, met een expliciete keuze) — AGENTS.md:
 * "twijfelachtige productmatches — eerst laten controleren, nooit
 * stilzwijgend kiezen".
 */
export async function addQuickOrderTrustedProducts(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);

  const choices = formData.getAll("choice").map(parseQuickOrderChoice);
  const validChoices = choices.filter(
    (choice) => choice.householdId === householdId && choice.productName && choice.externalRef
  );
  if (validChoices.length === 0) {
    throw new Error("Ik kon geen geldige producten toevoegen.");
  }

  const verifiedShoppingListIds = new Set<string>();
  for (const choice of validChoices) {
    if (!verifiedShoppingListIds.has(choice.shoppingListId)) {
      await assertShoppingListAccess(choice.shoppingListId);
      verifiedShoppingListIds.add(choice.shoppingListId);
    }
  }

  for (const choice of validChoices) {
    await saveQuickOrderLine(householdId, choice, "Automatisch herkend als jullie eerdere keuze.");
  }

  revalidatePath("/boodschappen");
  revalidatePath("/controle");

  // De regels die nog wél een handmatige keuze nodig hebben (geen
  // vertrouwde match) mogen na deze bulk-actie niet uit beeld verdwijnen —
  // streep alleen de zojuist automatisch toegevoegde regels uit de
  // resterende batchtekst, zodat hun zoekresultaten na de redirect
  // gewoon in beeld blijven.
  let remainingQuickOrderText = String(formData.get("quickOrderText") ?? "").trim();
  for (const choice of validChoices) {
    if (choice.raw) remainingQuickOrderText = removeBulkFixedGroceryLine(remainingQuickOrderText, choice.raw);
  }

  if (remainingQuickOrderText) {
    const params = new URLSearchParams({ quickOrder: remainingQuickOrderText, status: "quick-order-bulk-added" });
    redirect(`/boodschappen?${params.toString()}#quick-order`);
  }
  redirect("/boodschappen?status=quick-order-bulk-added#quick-order");
}
