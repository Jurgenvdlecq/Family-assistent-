"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold } from "@/lib/auth";
import { markTransferred } from "@/lib/picnicAdapter";
import { logFeedbackEvent } from "@/lib/feedback";
import { recordProductChosen } from "@/domain/product-matching/repository";
import {
  addShoppingListToPicnicCart,
  clearPicnicCartForShoppingList,
  type PicnicCartClearResult,
  type PicnicCartResult,
} from "@/lib/picnic/cartService";
import { buildConfirmationSummary, type ConfirmationSummary } from "@/lib/picnic/confirmationSummary";
import { describeLinePackaging, findShoppingListShortfalls, getGroceryMealEntries } from "@/lib/shoppingList";
import { getDeliveryOverviewForHousehold } from "@/lib/picnic/deliveryStatus";
import { formatSlotWindow } from "@/lib/picnic/deliverySlots";
import { getHouseholdPortionScaleForDate } from "@/lib/household";
import { getInventoryMap } from "@/lib/inventory";
import { assertShoppingListAccess } from "@/lib/shoppingListAccess";
import type { LineSource } from "@/generated/prisma/enums";

/**
 * WP91: "snelle bestelling" — vaste boodschappen en losse toevoegingen zijn
 * onafhankelijk van het weekmenu (in tegenstelling tot MEAL/INVENTORY-regels,
 * die uit de geplande maaltijden voortkomen). Bedoeld voor het scenario waar
 * je alleen even standaard boodschappen wilt bestellen zonder eerst het hele
 * weekmenu te doorlopen of ongecontroleerde weekmenu-regels mee te sturen.
 */
const QUICK_ORDER_SOURCES: LineSource[] = ["FIXED", "MANUAL"];
type PicnicTransferScope = "all" | "fixed";

/**
 * Server Actions zijn over het netwerk aanroepbaar met een willekeurige
 * payload — het TypeScript-type van `scope` is alleen een compileertijd-
 * garantie. Normaliseer expliciet zodat een vervalste waarde nooit tussen
 * "fixed" en "all" in valt (dat zou anders alle regels versturen zonder
 * ShoppingList.status op TRANSFERRED te zetten).
 */
function normalizeScope(scope: PicnicTransferScope): PicnicTransferScope {
  return scope === "fixed" ? "fixed" : "all";
}

export async function confirmTransfer(formData: FormData) {
  const shoppingListId = String(formData.get("shoppingListId"));
  await assertShoppingListAccess(shoppingListId);
  await markTransferred(shoppingListId);
  revalidatePath("/boodschappen");
}

async function loadEditableShoppingLine(lineId: string) {
  const line = await prisma.shoppingListLine.findUniqueOrThrow({
    where: { id: lineId },
    include: { shoppingList: { include: { mealPlan: { select: { householdId: true } } } }, product: true },
  });
  await assertCurrentHousehold(line.shoppingList.mealPlan.householdId);
  return { line, householdId: line.shoppingList.mealPlan.householdId };
}

function redirectToBoodschappenLine(lineId: string, status?: string): never {
  revalidatePath("/boodschappen");
  revalidatePath("/controle");
  const params = new URLSearchParams({ focusLine: lineId });
  if (status) params.set("status", status);
  redirect(`/boodschappen?${params.toString()}#day-line-${encodeURIComponent(lineId)}`);
}

function quantityStep(line: { unit: string; product: { packageQuantity: number | null } | null }) {
  if (line.product?.packageQuantity && line.product.packageQuantity > 0) return line.product.packageQuantity;
  return line.unit === "PIECE" ? 1 : 50;
}

export async function adjustBoodschappenLineQuantity(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const direction = String(formData.get("direction"));
  const { line } = await loadEditableShoppingLine(lineId);
  // Ook vaste boodschappen mogen hier aangepast worden. Dit verandert alleen
  // de regel van déze week, niet de vaste-boodschap-standaard zelf — precies
  // wat "twee pakken melk deze week" hoort te doen. Wie het wil onthouden,
  // gebruikt "onthouden als standaard" in het beheerscherm.
  const delta = quantityStep(line) * (direction === "decrease" ? -1 : 1);
  const nextQuantity = Math.max(quantityStep(line), line.quantity + delta);
  await prisma.shoppingListLine.update({
    where: { id: line.id },
    // shortfallAcknowledged terugzetten: dit is een nieuwe handmatige
    // hoeveelheid, dus een eventueel eerder geaccepteerd tekort moet opnieuw
    // beoordeeld worden in plaats van stil te blijven gelden.
    data: { quantity: nextQuantity, shortfallAcknowledged: false },
  });

  redirectToBoodschappenLine(line.id, "quantity");
}

export async function setBoodschappenLinePackageCount(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const packageCount = Number(formData.get("packageCount"));
  const { line } = await loadEditableShoppingLine(lineId);
  if (line.source === "FIXED") throw new Error("Gebruik de vaste-boodschappenregel om vaste boodschappen aan te passen.");
  if (!Number.isFinite(packageCount) || packageCount <= 0) {
    // Gewone typfout, geen tamper: leesbare melding op dezelfde regel.
    redirectToBoodschappenLine(lineId, "invalid-quantity");
  }

  const nextQuantity =
    line.product?.packageQuantity && line.product.packageQuantity > 0
      ? packageCount * line.product.packageQuantity
      : packageCount;

  await prisma.shoppingListLine.update({
    where: { id: line.id },
    data: { quantity: nextQuantity, shortfallAcknowledged: false },
  });

  redirectToBoodschappenLine(line.id, "quantity");
}

/**
 * Vult een regel aan tot precies wat de geplande maaltijden deze week nodig
 * hebben (netto na voorraad) — het "Aanvullen"-antwoord op een tekort-
 * melding. Rekent de behoefte hier opnieuw uit in plaats van een bedrag uit
 * het formulier te vertrouwen, zodat een verouderde of gemanipuleerde
 * waarde nooit een verkeerde hoeveelheid kan wegschrijven.
 */
export async function fillShoppingListShortfall(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const { line, householdId } = await loadEditableShoppingLine(lineId);
  if (line.source !== "MEAL") throw new Error("Aanvullen kan alleen voor boodschappen uit het weekmenu.");

  const shoppingList = await prisma.shoppingList.findUniqueOrThrow({
    where: { id: line.shoppingListId },
    select: { mealPlanId: true },
  });
  const [groceryMeals, portionScaleForDate, inventoryMap] = await Promise.all([
    getGroceryMealEntries(shoppingList.mealPlanId),
    getHouseholdPortionScaleForDate(householdId),
    getInventoryMap(householdId),
  ]);
  const [shortfall] = findShoppingListShortfalls(groceryMeals, portionScaleForDate, inventoryMap, [line]);

  await prisma.shoppingListLine.update({
    where: { id: line.id },
    data: { quantity: shortfall?.neededQuantity ?? line.quantity, shortfallAcknowledged: false },
  });

  redirectToBoodschappenLine(line.id, "shortfall-filled");
}

/** Bevestigt dat een kleiner-dan-benodigde hoeveelheid deze week bewust zo blijft. */
export async function acknowledgeShoppingListShortfall(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const { line } = await loadEditableShoppingLine(lineId);
  await prisma.shoppingListLine.update({
    where: { id: line.id },
    data: { shortfallAcknowledged: true },
  });
  redirectToBoodschappenLine(line.id, "shortfall-accepted");
}

export async function chooseBoodschappenProduct(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const productId = String(formData.get("productId"));
  const remember = String(formData.get("remember")) === "true";
  const { line, householdId } = await loadEditableShoppingLine(lineId);
  if (line.source === "FIXED") throw new Error("Gebruik de vaste-boodschappenregel om vaste boodschappen aan te passen.");

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { ingredientId: true },
  });
  if (product.ingredientId !== line.ingredientId) {
    throw new Error("Dit product hoort niet bij deze boodschappenregel.");
  }

  if (line.productId && line.productId !== productId) {
    await logFeedbackEvent({
      householdId,
      subjectType: "PRODUCT",
      subjectId: line.productId,
      eventType: "REPLACED",
      explicit: true,
      context: { source: "boodschappen_day_review" },
    });
  }

  await prisma.shoppingListLine.update({
    where: { id: line.id },
    data: {
      productId,
      needsReview: false,
      matchStatus: "MANUALLY_SELECTED",
      matchConfidence: 1,
      matchReasons: [
        remember
          ? "Handmatig gekozen op de dagcontrole en onthouden."
          : "Alleen deze week gekozen op de dagcontrole.",
      ],
    },
  });

  await logFeedbackEvent({
    householdId,
    subjectType: "PRODUCT",
    subjectId: productId,
    eventType: "CHOSEN",
    explicit: true,
    context: { source: "boodschappen_day_review", onceOnly: !remember },
  });

  if (remember) {
    await recordProductChosen(householdId, line.ingredientId, productId, "MANUAL");
  }

  redirectToBoodschappenLine(line.id, remember ? "remembered" : "week-only");
}

export async function removeBoodschappenLineThisWeek(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const { line } = await loadEditableShoppingLine(lineId);
  // Een regel die al in het echte Picnic-mandje ligt kan de app hier niet
  // wegnemen — hem alleen van de lijst halen zou liegen (het product blijft
  // gewoon besteld worden) én de "ligt al in je mandje"-markering wissen,
  // waardoor een volgende overdracht 'm dubbel toevoegt.
  if (line.transferredToPicnicAt) {
    redirect("/boodschappen?status=line-in-picnic-cart#jullie-boodschappenlijst");
  }
  // Ook bruikbaar voor vaste boodschappen (source FIXED): dit verwijdert
  // alleen de regel van déze week, de vaste-boodschap-sjabloon zelf blijft
  // ongewijzigd bestaan — exact dezelfde bewerking als removeFixedLineThisWeek
  // in fixedGroceriesActions.ts, alleen met een andere redirect-anker.
  await prisma.shoppingListLine.delete({ where: { id: line.id } });
  revalidatePath("/boodschappen");
  revalidatePath("/controle");
  // Het id van de zojuist verwijderde regel maakt deze URL uniek. Zonder dat
  // is de bestemming exact de pagina waar je al staat, en dan slaat de router
  // de navigatie over: de regel bleef dan gewoon staan terwijl hij in de
  // database allang weg was (zelfde oorzaak als bij de dagkeuze).
  redirect(
    `/boodschappen?status=line-removed&verwijderd=${encodeURIComponent(line.id)}#jullie-boodschappenlijst`
  );
}

export type ConfirmationDeliveryCheck = {
  checkedAt: Date;
  /** De eerstvolgende dagen waarop Picnic nog vrije tijdvakken heeft. */
  days: Array<{ label: string; windows: string[] }>;
  /** Minimale bestelwaarde zoals Picnic die meegeeft, of null als die onbekend is. */
  minimumOrderValue: number | null;
  error: "auth" | "other" | null;
};

export type PicnicConfirmationDetails = ConfirmationSummary & {
  /** `null` zonder Picnic-koppeling — dan valt er niets te controleren. */
  delivery: ConfirmationDeliveryCheck | null;
};

/** Hoeveel bezorgdagen het bevestigingsscherm noemt — genoeg om te zien dat het kan, kort genoeg om te lezen. */
const CONFIRMATION_DELIVERY_DAYS = 2;

/**
 * Bevestigingssamenvatting vóór het echt vullen van het Picnic-mandje
 * (Fase 7/8).
 *
 * Haalt op dit moment ook de bezorgmomenten opnieuw op. Dat is bewust hier en
 * niet alleen bij het laden van de pagina: een scherm dat al even openstaat is
 * een momentopname, en dit is het laatste moment waarop de gebruiker nog kan
 * besluiten om te wachten. Faalt die controle, dan blokkeert dat het
 * bevestigen niet — het mandje vullen is iets anders dan een bezorgmoment
 * vastleggen, en dat laatste doet de app sowieso niet.
 */
export async function getPicnicConfirmationSummary(
  shoppingListId: string,
  rawScope: PicnicTransferScope = "all"
): Promise<PicnicConfirmationDetails> {
  const scope = normalizeScope(rawScope);
  const accessibleList = await assertShoppingListAccess(shoppingListId);
  const shoppingList = await prisma.shoppingList.findUniqueOrThrow({
    where: { id: shoppingListId },
    include: { lines: { include: { ingredient: true, product: true } } },
  });
  const lines =
    scope === "fixed" ? shoppingList.lines.filter((line) => QUICK_ORDER_SOURCES.includes(line.source)) : shoppingList.lines;

  const summary = buildConfirmationSummary(
    lines.map((line) => ({
      ingredientName: line.ingredient.name,
      source: line.source,
      matchStatus: line.matchStatus,
      transferredToPicnicAt: line.transferredToPicnicAt,
      packageCount: line.product
        ? Math.max(
            1,
            describeLinePackaging(
              { quantity: line.quantity, unit: line.unit },
              { packageQuantity: line.product.packageQuantity }
            ).packagesToBuy || 1
          )
        : 1,
      product: line.product
        ? {
            name: line.product.name,
            price: line.product.price !== null ? Number(line.product.price) : null,
            lastSeenAvailable: line.product.lastSeenAvailable,
          }
        : null,
    }))
  );

  const household = await prisma.household.findUniqueOrThrow({
    where: { id: accessibleList.mealPlan.householdId },
    select: { id: true, picnicAuthToken: true },
  });
  if (!household.picnicAuthToken) {
    return { ...summary, delivery: null };
  }

  const preference = await prisma.picnicDeliveryPreference.findUnique({
    where: { householdId: household.id },
  });
  const overview = await getDeliveryOverviewForHousehold({
    householdId: household.id,
    picnicAuthToken: household.picnicAuthToken,
    preference,
  });
  const daysWithRoom = overview.groups.filter((group) => group.availableSlots.length > 0);

  return {
    ...summary,
    delivery: {
      checkedAt: overview.fetchedAt,
      days: daysWithRoom.slice(0, CONFIRMATION_DELIVERY_DAYS).map((group) => ({
        label: group.label,
        windows: group.availableSlots.map(formatSlotWindow),
      })),
      minimumOrderValue:
        daysWithRoom
          .flatMap((group) => group.availableSlots)
          .find((slot) => slot.minimumOrderValue !== undefined)?.minimumOrderValue ?? null,
      error: overview.error,
    },
  };
}

export async function addToPicnicCart(
  shoppingListId: string,
  rawScope: PicnicTransferScope = "all"
): Promise<PicnicCartResult> {
  const scope = normalizeScope(rawScope);
  await assertShoppingListAccess(shoppingListId);
  const result = await addShoppingListToPicnicCart(
    shoppingListId,
    scope === "fixed" ? { onlySources: QUICK_ORDER_SOURCES } : undefined
  );
  // Bij scope "fixed" zijn de weekmenu-regels bewust niet meegestuurd — de
  // lijst als geheel is dan nooit "overgedragen", dus markTransferred (dat
  // de hele ShoppingList.status omzet) mag hier niet aangeroepen worden.
  if (scope === "all" && result.notFound.length === 0 && result.errors.length === 0) {
    await markTransferred(shoppingListId);
  }
  revalidatePath("/boodschappen");
  return result;
}

export async function clearPicnicCart(shoppingListId: string): Promise<PicnicCartClearResult> {
  await assertShoppingListAccess(shoppingListId);
  const result = await clearPicnicCartForShoppingList(shoppingListId);
  if (!result.ok) return result;

  // Een geleegd mandje is per definitie niet meer besteld — een oude
  // bevestiging zou anders blijven staan terwijl de situatie niet meer klopt.
  await prisma.shoppingList.update({ where: { id: shoppingListId }, data: { orderConfirmedAt: null } });
  revalidatePath("/boodschappen");
  return result;
}

/**
 * WP69: expliciete, optionele bevestiging dat de gebruiker de bestelling in
 * Picnic zelf heeft afgerond. Family Assistant kan dit nooit betrouwbaar
 * zelf verifiëren (Fase 7/8: geen bestel-API) — dit is puur zodat de
 * "rond je bestelling af"-herinnering kan stoppen, geen harde claim.
 */
export async function confirmPicnicOrder(shoppingListId: string): Promise<void> {
  await assertShoppingListAccess(shoppingListId);
  await prisma.shoppingList.update({ where: { id: shoppingListId }, data: { orderConfirmedAt: new Date() } });
  revalidatePath("/boodschappen");
  revalidatePath("/week");
}

/**
 * Afvinklijst voor zelf boodschappen doen — losstaand van de Picnic-flow,
 * dus geen redirect/statusmelding nodig zoals bij de andere regelacties:
 * je wil door 20 producten heen kunnen tikken zonder telkens een hele
 * paginaherlaad. `pickedUp` komt rechtstreeks van de client (optimistisch
 * al omgewisseld), zodat een dubbele tik nooit per ongeluk terugklapt.
 */
export async function toggleShoppingListLinePickedUp(lineId: string, pickedUp: boolean): Promise<void> {
  const { line } = await loadEditableShoppingLine(lineId);
  await prisma.shoppingListLine.update({
    where: { id: line.id },
    data: { pickedUpAt: pickedUp ? new Date() : null },
  });
  revalidatePath("/boodschappen");
}
