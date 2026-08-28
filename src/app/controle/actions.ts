"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold } from "@/lib/auth";
import { logFeedbackEvent } from "@/lib/feedback";
import { acceptProposedMealPlanEntries } from "@/lib/mealPlan";
import { recordProductChosen, recordProductRejected } from "@/domain/product-matching/repository";
import { matchProductForIngredient } from "@/domain/product-matching/matchIngredient";
import { PicnicClient, PicnicAuthError } from "@/lib/picnic/client";
import { picnicPriceToEuros, picnicProductRef } from "@/lib/picnic/products";
import { parsePackageQuantity } from "@/lib/quantity/parsePackageSize";

async function loadLineForCurrentHousehold(lineId: string) {
  const line = await prisma.shoppingListLine.findUniqueOrThrow({
    where: { id: lineId },
    include: { shoppingList: { include: { mealPlan: { select: { householdId: true } } } } },
  });
  await assertCurrentHousehold(line.shoppingList.mealPlan.householdId);
  return { line, householdId: line.shoppingList.mealPlan.householdId };
}

function refreshControle(lineId?: string, status?: string): never {
  revalidatePath("/controle");
  revalidatePath("/boodschappen");
  if (lineId) {
    const params = new URLSearchParams({ focus: lineId });
    if (status) params.set("status", status);
    redirect(`/controle?${params.toString()}#line-${encodeURIComponent(lineId)}`);
  }
  redirect("/controle");
}

/**
 * Voor acties die een twijfelgeval echt kunnen oplossen (kiezen, alleen deze
 * week, zonder product doorgaan, verwijderen, of een afwijzing die toevallig
 * meteen weer een vertrouwde match oplevert): spring door naar de eerstvolgende
 * regel die nog aandacht vraagt, in plaats van terug te redirecten naar
 * dezelfde (nu opgeloste) regel — bugfix voor "moet zelf weer scrollen/zoeken
 * naar het volgende twijfelgeval". Blijft de regel zelf toch nog een
 * twijfelgeval (bv. afwijzen leverde geen vertrouwde match op), dan blijft de
 * gebruiker gewoon op die regel — er valt daar nog iets te doen.
 *
 * Toont de statusmelding bewust niet meer per-regel (`focus`-param) zoals
 * `refreshControle` doet: bij het doorspringen zou die anders ten onrechte op
 * de vólgende (niet-aangeraakte) regel verschijnen. `page.tsx` toont in dit
 * geval een algemene melding bovenaan, net als op `/boodschappen`.
 */
async function redirectToNextReviewLine(shoppingListId: string, resolvedLineId: string, status: string) {
  revalidatePath("/controle");
  revalidatePath("/boodschappen");

  const remaining = await prisma.shoppingListLine.findMany({
    where: { shoppingListId, needsReview: true },
    include: { ingredient: { select: { name: true } } },
  });
  remaining.sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name));

  if (remaining.some((l) => l.id === resolvedLineId)) {
    redirect(`/controle?status=${status}#line-${encodeURIComponent(resolvedLineId)}`);
  }
  const next = remaining[0];
  if (next) {
    redirect(`/controle?status=${status}#line-${encodeURIComponent(next.id)}`);
  }
  redirect(`/controle?status=${status}`);
}

export async function confirmProductChoice(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const productId = String(formData.get("productId"));
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);

  const { line } = await loadLineForCurrentHousehold(lineId);

  if (line.productId && line.productId !== productId) {
    await logFeedbackEvent({
      householdId,
      subjectType: "PRODUCT",
      subjectId: line.productId,
      eventType: "REPLACED",
      explicit: true,
    });
  }

  await prisma.shoppingListLine.update({
    where: { id: lineId },
    data: {
      productId,
      needsReview: false,
      matchStatus: "MANUALLY_SELECTED",
      matchConfidence: 1,
      matchReasons: ["Handmatig gekozen op het Controle-scherm."],
    },
  });

  await logFeedbackEvent({
    householdId,
    subjectType: "PRODUCT",
    subjectId: productId,
    eventType: "CHOSEN",
    explicit: true,
    context: { source: "controle_screen" },
  });

  // Vertrouwde keuze onthouden — volgende week is dit geen twijfelgeval meer
  // (productkeuze-prioriteitsregel #1 uit sectie 10 van de Blueprint).
  await recordProductChosen(householdId, line.ingredientId, productId, "MANUAL");

  await redirectToNextReviewLine(line.shoppingListId, lineId, "remembered");
}

/**
 * Wijst een voorgesteld product expliciet af: het komt niet meer terug als
 * automatische suggestie voor dit ingrediënt (Fase 5: "afgewezen
 * producten"), en de regel wordt meteen opnieuw gematcht met de overige
 * kandidaten.
 */
export async function rejectProductChoice(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const productId = String(formData.get("productId"));
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);

  const { line } = await loadLineForCurrentHousehold(lineId);

  await recordProductRejected(householdId, line.ingredientId, productId);
  await logFeedbackEvent({
    householdId,
    subjectType: "PRODUCT",
    subjectId: productId,
    eventType: "IGNORED",
    explicit: true,
    context: { source: "controle_screen" },
  });

  const match = await matchProductForIngredient(householdId, line.ingredientId);
  await prisma.shoppingListLine.update({
    where: { id: lineId },
    data: {
      productId: match.productId,
      needsReview: match.status !== "MATCHED_TRUSTED",
      matchStatus: match.status,
      matchConfidence: match.confidence,
      matchReasons: match.reasons,
    },
  });

  // Meestal levert een afwijzing weer een nieuw twijfelgeval op (blijft dus
  // op deze regel staan, zie redirectToNextReviewLine), maar soms is de
  // eerstvolgende kandidaat toevallig al een vertrouwde match — dan mag de
  // gebruiker net als bij de andere oplossende acties gewoon doorstromen.
  await redirectToNextReviewLine(line.shoppingListId, lineId, "rejected");
}

/**
 * Kiest een alternatief voor déze keer, zonder het als nieuwe standaard-
 * voorkeur te onthouden (Fase 6: "alleen deze week gebruiken" is een aparte
 * actie naast "goedkeuren", die wél onthoudt).
 */
export async function useProductThisWeekOnly(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const productId = String(formData.get("productId"));
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);

  const { line } = await loadLineForCurrentHousehold(lineId);

  if (line.productId && line.productId !== productId) {
    await logFeedbackEvent({
      householdId,
      subjectType: "PRODUCT",
      subjectId: line.productId,
      eventType: "REPLACED",
      explicit: true,
    });
  }

  await prisma.shoppingListLine.update({
    where: { id: lineId },
    data: {
      productId,
      needsReview: false,
      matchStatus: "MANUALLY_SELECTED",
      matchConfidence: 1,
      matchReasons: ["Alleen deze week gekozen — volgende week vraagt dit opnieuw om een keuze."],
    },
  });

  await logFeedbackEvent({
    householdId,
    subjectType: "PRODUCT",
    subjectId: productId,
    eventType: "CHOSEN",
    explicit: true,
    context: { source: "controle_screen", onceOnly: true },
  });

  await redirectToNextReviewLine(line.shoppingListId, lineId, "week-only");
}

/** Past de hoeveelheid van deze ene regel aan (bv. een twijfelgeval bleek toch meer of minder nodig te hebben). */
export async function adjustLineQuantity(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  await loadLineForCurrentHousehold(lineId);
  const quantity = Number(formData.get("quantity"));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    // Gewone typfout, geen tamper: leesbare melding op dezelfde regel.
    refreshControle(lineId, "invalid-quantity");
  }

  await prisma.shoppingListLine.update({ where: { id: lineId }, data: { quantity } });
  refreshControle(lineId, "quantity");
}

export async function searchPicnicProductsForLine(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const query = String(formData.get("query") ?? "").trim();
  const { line, householdId } = await loadLineForCurrentHousehold(lineId);

  const household = await prisma.household.findUniqueOrThrow({ where: { id: householdId } });
  if (!household.picnicAuthToken) {
    // Bereikbaar voor iedereen die Picnic (nog) niet gekoppeld heeft — nette
    // uitleg op de regel zelf i.p.v. een in productie geredacte throw.
    refreshControle(lineId, "picnic-not-connected");
  }

  const ingredient = await prisma.ingredient.findUniqueOrThrow({
    where: { id: line.ingredientId },
    select: { name: true, unit: true },
  });
  const searchTerm = query || ingredient.name;
  const client = new PicnicClient(household.picnicAuthToken);
  let results;
  try {
    results = await client.search(searchTerm);
  } catch (err) {
    // Een verlopen sessie of Picnic-storing mag geen doodlopende generieke
    // foutpagina worden — terug naar de regel met een duidelijke vervolgstap.
    refreshControle(lineId, err instanceof PicnicAuthError ? "picnic-session-expired" : "picnic-unreachable");
  }

  const seenRefs = new Set<string>();
  const productsToSave = results.slice(0, 12).flatMap((item) => {
    const externalRef = picnicProductRef(item);
    if (!externalRef || !item.name || seenRefs.has(externalRef)) return [];
    seenRefs.add(externalRef);

    const packageSize = item.unit_quantity ?? null;
    const data = {
      ingredientId: line.ingredientId,
      externalRef,
      picnicImageId: item.image_id ?? null,
      name: item.name,
      packageSize,
      packageQuantity: parsePackageQuantity(packageSize, ingredient.unit),
      price: picnicPriceToEuros(item.display_price ?? item.price),
      lastSeenAvailable: new Date(),
    };
    return [data];
  });

  await Promise.all(
    productsToSave.map((data) =>
      prisma.product.upsert({
        where: {
          ingredientId_provider_externalRef: {
            ingredientId: data.ingredientId,
            provider: "PICNIC",
            externalRef: data.externalRef,
          },
        },
        update: data,
        create: data,
      })
    )
  );

  await persistRefreshedToken(client, householdId, household.picnicAuthToken);

  // Alleen een al-twijfelend twijfelgeval krijgt hier een bijgewerkte
  // status/reden — de nieuwe kandidaten staan sowieso al klaar via de
  // product-upsert hierboven. Bugfix: dit zette voorheen ook een vertrouwde
  // regel (needsReview: false) altijd terug op "controleren", puur omdat je
  // even was gaan rondkijken naar alternatieven vanuit "vertrouwde keuzes
  // bekijken" — zonder dat je daadwerkelijk iets anders had gekozen.
  if (line.needsReview) {
    await prisma.shoppingListLine.update({
      where: { id: lineId },
      data: {
        matchStatus: "MATCHED_REVIEW_REQUIRED",
        matchConfidence: 0.5,
        matchReasons:
          productsToSave.length > 0
            ? [`${productsToSave.length} live Picnic-producten gevonden voor "${searchTerm}". Kies het juiste product.`]
            : [`Geen live Picnic-producten gevonden voor "${searchTerm}". Probeer een andere zoekterm.`],
      },
    });
  }

  refreshControle(lineId, "searched");
}

async function persistRefreshedToken(client: PicnicClient, householdId: string, previousToken: string | null) {
  const refreshedToken = client.getAuthToken();
  if (refreshedToken && refreshedToken !== previousToken) {
    await prisma.household.update({
      where: { id: householdId },
      data: { picnicAuthToken: refreshedToken, picnicTokenUpdatedAt: new Date() },
    });
  }
}

/** Verwijdert een regel volledig van de lijst — voor producten die niet gevonden zijn en niet nodig blijken. */
export async function removeLineFromList(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const { line } = await loadLineForCurrentHousehold(lineId);
  // Ligt het product al in het echte Picnic-mandje, dan kan de app het hier
  // niet wegnemen: van de lijst halen zou de "ligt al in je mandje"-markering
  // wissen en een volgende overdracht zou het dubbel toevoegen.
  if (line.transferredToPicnicAt) {
    await redirectToNextReviewLine(line.shoppingListId, lineId, "line-in-picnic-cart");
  }
  await prisma.shoppingListLine.delete({ where: { id: lineId } });
  await redirectToNextReviewLine(line.shoppingListId, lineId, "removed");
}

export async function skipReview(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const { line } = await loadLineForCurrentHousehold(lineId);
  await prisma.shoppingListLine.update({
    where: { id: lineId },
    data: { needsReview: false },
  });
  await redirectToNextReviewLine(line.shoppingListId, lineId, "skipped");
}

export async function confirmShoppingList(formData: FormData) {
  const shoppingListId = String(formData.get("shoppingListId"));
  const shoppingList = await prisma.shoppingList.findUniqueOrThrow({
    where: { id: shoppingListId },
    include: { mealPlan: { select: { id: true, householdId: true } } },
  });
  await assertCurrentHousehold(shoppingList.mealPlan.householdId);
  await acceptProposedMealPlanEntries(shoppingList.mealPlan.householdId, shoppingList.mealPlan.id);
  await prisma.shoppingList.update({
    where: { id: shoppingListId },
    data: { status: "REVIEWED", reviewedAt: new Date() },
  });
  revalidatePath("/boodschappen");
  revalidatePath("/week");
  redirect("/boodschappen?status=shopping-reviewed#jullie-boodschappenlijst");
}
