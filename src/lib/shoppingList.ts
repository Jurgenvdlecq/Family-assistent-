import { prisma } from "./prisma";
import type { Unit, InventoryStatus } from "@/generated/prisma/enums";
import { getInventoryMap } from "./inventory";
import { subtractInventory } from "./quantity/inventory";
import { resolveInStockQuantity } from "./quantity/inventoryStatus";
import type { BaseQuantity } from "./quantity/units";
import { getCurrentWeekStart, dateForDay, DAY_KEY_BY_ENUM } from "./week";
import { getHouseholdPortionScaleForDate, type PortionScaleForDate } from "./household";
import { matchProduct } from "@/domain/product-matching/matchProduct";
import { matchProductForIngredient } from "@/domain/product-matching/matchIngredient";
import { getRejectedProductIds, getTrustedPreferences, toMatchCandidate } from "@/domain/product-matching/repository";
import type { ProductMatchResult } from "@/domain/product-matching/types";
import { productChoicePreferenceFromDeliveryPreference } from "@/domain/product-matching/productChoicePreference";
import { calculatePackageRequirement, type PackageRequirementResult } from "./quantity/packages";
import type { DayOfWeek } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { logEvent, createCorrelationId } from "./logger";

type InventoryLookup = Awaited<ReturnType<typeof getInventoryMap>>;

// Bewust een minimale, structurele vorm i.p.v. het volledige Prisma-payload-
// type van getMealPlanForWeek: dit is alles wat de behoefteberekening nodig
// heeft, en maakt hem in tests met eenvoudige literals te vullen.
interface MealPlanWithEntries {
  entries: Array<{
    dayOfWeek: DayOfWeek;
    /**
     * De concrete datum van deze avond. Nodig omdat de behoefte geschaald
     * wordt op wie er dán mee-eet: een lijst kan avonden uit twee weken
     * bevatten, en die twee weken hebben altijd een verschillende
     * oneven/even-pariteit.
     */
    date: Date;
    /** Huishouden eet deze dag niet thuis — telt niet mee in de behoefte. */
    skipped: boolean;
    /**
     * Neemt de gebruiker deze avond mee in de eerstvolgende bestelling? Los
     * van `skipped`: je kunt thuis koken van wat er al ligt. Beide moeten
     * kloppen voordat een avond boodschappen oplevert.
     */
    includedInGroceries: boolean;
    recipeVariant: {
      recipe: {
        ingredients: Array<{ ingredientId: string; quantity: number; unit: Unit }>;
      };
    };
  }>;
}

/**
 * Telt de receptbehoefte per ingrediënt op over alle geplande maaltijden van
 * de week, geschaald op wie er per dag mee-eet. Gedeeld door `ensureShoppingList`
 * (bij het aanmaken van de lijst) en `findShoppingListShortfalls` (om een
 * bestaande, mogelijk handmatig aangepaste regel te controleren) — zodat
 * beide altijd exact dezelfde "wat is er eigenlijk nodig"-berekening gebruiken.
 */
function aggregateMealNeeds(
  mealPlan: MealPlanWithEntries,
  portionScaleForDate: PortionScaleForDate
): Map<string, { ingredientId: string; quantity: number; unit: Unit }> {
  const totals = new Map<string, { ingredientId: string; quantity: number; unit: Unit }>();
  for (const entry of mealPlan.entries) {
    // Twee losse redenen om een avond niet mee te tellen: het huishouden eet
    // niet thuis (`skipped`), of de gebruiker heeft deze avond niet
    // aangevinkt voor de eerstvolgende bestelling (`includedInGroceries`).
    if (entry.skipped || !entry.includedInGroceries) continue;
    const scale = portionScaleForDate(entry.date).scale;
    for (const ri of entry.recipeVariant.recipe.ingredients) {
      const key = `${ri.ingredientId}:${ri.unit}`;
      const scaledQuantity = ri.quantity * scale;
      const current = totals.get(key);
      if (current) {
        current.quantity += scaledQuantity;
      } else {
        totals.set(key, { ingredientId: ri.ingredientId, quantity: scaledQuantity, unit: ri.unit });
      }
    }
  }
  return totals;
}

/**
 * Trekt de voorraad van dit ingrediënt af van de behoefte (Fase 3: "voorraad
 * aftrekken"). Geeft `null` terug wanneer er per saldo niets meer te kopen
 * is — de aanroeper moet dan gewoon geen regel aanmaken.
 */
function netAfterInventory(
  need: BaseQuantity,
  ingredientId: string,
  inventory: InventoryLookup
): BaseQuantity | null {
  const item = inventory.get(ingredientId);
  const status: InventoryStatus = item?.status ?? "UNKNOWN";
  const explicit = item?.quantity != null && item.unit ? { amount: item.quantity, unit: item.unit } : null;
  const inStock = resolveInStockQuantity(status, explicit, need);
  const net = subtractInventory(need, inStock);
  return net.amount > 0 ? net : null;
}

/** Zet een uitlegbare match (Fase 5) om naar de velden die op een ShoppingListLine terechtkomen. */
function matchToLineFields(match: ProductMatchResult) {
  return {
    productId: match.productId,
    needsReview: match.status !== "MATCHED_TRUSTED",
    matchStatus: match.status,
    matchConfidence: match.confidence,
    matchReasons: match.reasons,
  };
}

/**
 * Zorgt dat er een boodschappenlijst bestaat voor deze weekplanning —
 * automatisch afgeleid uit de gekozen maaltijden (sectie 10 van de
 * Blueprint: "Van maaltijd naar mandje") én aangevuld met de vaste
 * boodschappen van het huishouden (Fase 4).
 */
export async function ensureShoppingList(mealPlanId: string, householdId: string) {
  const existing = await prisma.shoppingList.findUnique({
    where: { mealPlanId },
    include: {
      lines: {
        include: { ingredient: true, product: true },
      },
    },
  });
  if (existing) return existing;

  const { lines: allLines, reviewCount } = await buildShoppingListLines(mealPlanId, householdId);

  try {
    return await prisma.shoppingList.create({
      data: {
        mealPlanId,
        status: "PREPARED",
        // WP69: betrouwbaar "sinds wanneer staat controle open" voor de
        // attention-laag — meteen gezet bij aanmaken, niet pas later afgeleid.
        reviewFlaggedAt: reviewCount > 0 ? new Date() : null,
        lines: { create: allLines },
      },
      include: {
        lines: { include: { ingredient: true, product: true } },
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Twee bijna-gelijktijdige aanvragen voor dezelfde weekplanning: een
      // andere aanvraag heeft de lijst net aangemaakt. Die teruggeven i.p.v.
      // crashen op de unique constraint (meal_plan_id).
      logEvent({
        level: "info",
        area: "product_matching",
        message: "Boodschappenlijst samenstellen: race met gelijktijdige aanvraag, bestaande lijst gebruikt",
        correlationId: createCorrelationId(),
        meta: { householdId, mealPlanId },
      });
      const winner = await prisma.shoppingList.findUnique({
        where: { mealPlanId },
        include: { lines: { include: { ingredient: true, product: true } } },
      });
      if (winner) return winner;
    }
    throw error;
  }
}

/**
 * Stelt de regels van een boodschappenlijst samen uit het weekmenu, de vaste
 * boodschappen en de voorraadaanvulling — zonder ze op te slaan. Los van
 * `ensureShoppingList` zodat ook `invalidateShoppingList` de lijst opnieuw
 * kan samenstellen wanneer er al regels naar Picnic zijn overgedragen (die
 * mogen dan niet zomaar verdwijnen, zie daar).
 */
const MEAL_ENTRY_INCLUDE = {
  recipeVariant: {
    include: {
      recipe: { include: { ingredients: { include: { ingredient: true } } } },
    },
  },
} as const;

/**
 * De maaltijden die meetellen voor de eerstvolgende bestelling.
 *
 * Dat zijn niet alleen de avonden van déze week: sinds de dagkeuze mag de
 * gebruiker ook avonden aanvinken die ná de weekgrens vallen (bezorging op
 * zaterdag, koken op dinsdag). Een boodschappenlijst hangt aan één weekplan,
 * maar de behoefte mag dus uit twee plannen komen. Filteren op
 * `skipped`/`includedInGroceries` gebeurt bewust niet hier maar in
 * `aggregateMealNeeds`, zodat er één plek is waar die regel staat.
 *
 * Gedeeld door de lijstopbouw, de tekortcontrole en de voorraadsynchronisatie
 * — die moeten per definitie dezelfde maaltijden zien, anders meldt de één
 * een tekort op een gerecht dat de ander niet in de lijst heeft gezet.
 */
export async function getGroceryMealEntries(mealPlanId: string) {
  const mealPlan = await prisma.mealPlan.findUniqueOrThrow({
    where: { id: mealPlanId },
    include: { entries: { include: MEAL_ENTRY_INCLUDE } },
  });

  const nextWeekStart = new Date(mealPlan.weekStart);
  nextWeekStart.setDate(nextWeekStart.getDate() + 7);
  const nextWeekPlan = await prisma.mealPlan.findUnique({
    where: { householdId_weekStart: { householdId: mealPlan.householdId, weekStart: nextWeekStart } },
    include: { entries: { include: MEAL_ENTRY_INCLUDE } },
  });

  // De datum per avond staat nergens op de rij zelf (alleen de weekdag), maar
  // is wél nodig om op de juiste aanwezigheid te schalen — en juist hier is
  // bekend uit welk weekplan een avond komt.
  const withDate = <T extends { dayOfWeek: DayOfWeek }>(entries: T[], weekStart: Date) =>
    entries.map((entry) => ({ ...entry, date: dateForDay(weekStart, DAY_KEY_BY_ENUM[entry.dayOfWeek]) }));

  return {
    mealPlan,
    /** Kan `null` zijn: de volgende week wordt pas gepland zodra iemand er een avond voor aanvinkt. */
    nextWeekPlan,
    entries: [
      ...withDate(mealPlan.entries, mealPlan.weekStart),
      ...(nextWeekPlan ? withDate(nextWeekPlan.entries, nextWeekPlan.weekStart) : []),
    ],
  };
}

async function buildShoppingListLines(mealPlanId: string, householdId: string) {
  const [mealPlan, fixedGroceries, inventory, likelyInStockIngredients, portionScaleForDate, household] = await Promise.all([
    getGroceryMealEntries(mealPlanId),
    prisma.fixedGrocery.findMany({ where: { householdId } }),
    getInventoryMap(householdId),
    prisma.ingredient.findMany({ where: { likelyInStock: true }, select: { id: true, unit: true } }),
    getHouseholdPortionScaleForDate(householdId),
    prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: { deliveryPreference: true } }),
  ]);
  const productChoicePreference = productChoicePreferenceFromDeliveryPreference(household.deliveryPreference);

  const totals = aggregateMealNeeds(mealPlan, portionScaleForDate);

  // Voorraadcontrole vult alleen aan waar het weekmenu en de vaste
  // boodschappen nog geen regel voor hebben — anders zou hetzelfde
  // ingrediënt twee keer op de lijst kunnen komen (Fase 4, stap 2).
  const coveredIngredientIds = new Set(Array.from(totals.values()).map((t) => t.ingredientId));
  for (const fixed of fixedGroceries) coveredIngredientIds.add(fixed.ingredientId);
  const lowStockToReplenish = likelyInStockIngredients.filter((ing) => {
    if (coveredIngredientIds.has(ing.id)) return false;
    const status = inventory.get(ing.id)?.status ?? "UNKNOWN";
    return status === "LOW" || status === "OUT_OF_STOCK";
  });

  const ingredientIds = new Set(coveredIngredientIds);
  for (const ing of lowStockToReplenish) ingredientIds.add(ing.id);
  const ingredientIdList = Array.from(ingredientIds);

  const [allCandidates, trustedByIngredient, rejectedByIngredient] = await Promise.all([
    prisma.product.findMany({ where: { ingredientId: { in: ingredientIdList } } }),
    getTrustedPreferences(householdId, ingredientIdList),
    getRejectedProductIds(householdId, ingredientIdList),
  ]);

  const candidatesByIngredient = new Map<string, typeof allCandidates>();
  for (const product of allCandidates) {
    if (!product.ingredientId) continue;
    const list = candidatesByIngredient.get(product.ingredientId) ?? [];
    list.push(product);
    candidatesByIngredient.set(product.ingredientId, list);
  }

  function runMatch(ingredientId: string): ProductMatchResult {
    const candidates = candidatesByIngredient.get(ingredientId) ?? [];
    return matchProduct({
      candidates: candidates.map(toMatchCandidate),
      trusted: trustedByIngredient.get(ingredientId) ?? null,
      rejectedProductIds: rejectedByIngredient.get(ingredientId) ?? new Set(),
      productChoicePreference,
    });
  }

  // Voorraad aftrekken (Fase 3): een ingrediënt dat als "genoeg op voorraad"
  // is gemarkeerd, verlaagt of schrapt de receptbehoefte voor deze week.
  const mealLines = Array.from(totals.values())
    .map((t) => {
      const net = netAfterInventory({ amount: t.quantity, unit: t.unit }, t.ingredientId, inventory);
      if (!net) return null;
      return {
        ingredientId: t.ingredientId,
        quantity: net.amount,
        unit: net.unit,
        source: "MEAL" as const,
        ...matchToLineFields(runMatch(t.ingredientId)),
      };
    })
    .filter((line) => line !== null);

  const inventoryLines = lowStockToReplenish.map((ing) => {
    const match = runMatch(ing.id);
    const candidates = candidatesByIngredient.get(ing.id) ?? [];
    const matchedProduct = candidates.find((c) => c.id === match.productId);
    return {
      ingredientId: ing.id,
      quantity: matchedProduct?.packageQuantity ?? 1,
      unit: ing.unit,
      source: "INVENTORY" as const,
      // Altijd controleren: de gebruiker gaf alleen een status door
      // ("bijna op"), geen exacte hoeveelheid — ongeacht hoe zeker de
      // productmatch zelf is.
      ...matchToLineFields(match),
      needsReview: true,
    };
  });

  const fixedLines = fixedGroceries.map((fixed) => ({
    ingredientId: fixed.ingredientId,
    quantity: fixed.quantity,
    unit: fixed.unit,
    source: "FIXED" as const,
    ...matchToLineFields(runMatch(fixed.ingredientId)),
  }));

  const allLines = [...mealLines, ...fixedLines, ...inventoryLines];
  const notFoundCount = allLines.filter((line) => line.matchStatus === "NOT_FOUND").length;
  const reviewCount = allLines.filter((line) => line.needsReview).length;
  logEvent({
    level: notFoundCount > 0 ? "warn" : "info",
    area: "product_matching",
    message: "Boodschappenlijst samengesteld",
    correlationId: createCorrelationId(),
    meta: { householdId, mealPlanId, totalLines: allLines.length, notFoundCount, reviewCount },
  });

  return { lines: allLines, reviewCount };
}

/**
 * Wordt aangeroepen als de weekplanning wijzigt — de lijst moet dan opnieuw
 * berekend worden.
 *
 * Belangrijk: regels die al naar het Picnic-mandje zijn overgedragen
 * (`transferredToPicnicAt`) worden hierbij **nooit** weggegooid. Die staan
 * echt in het mandje van de gebruiker; zou de app ze vergeten, dan zou een
 * volgende "Toevoegen aan Picnic-mandje" ze doodleuk nog een keer bestellen
 * (de idempotentie in `cartService` leunt volledig op deze markering). Zolang
 * er nog niets is overgedragen kan de lijst gewoon weg en wordt hij bij het
 * volgende bezoek lui opnieuw opgebouwd — dat is het normale, goedkope geval.
 */
/**
 * Invalideert de boodschappenlijst die door een wijziging in dít weekplan
 * geraakt wordt.
 *
 * Sinds de dagkeuze mag de lijst van de huidige week ook maaltijden uit de
 * volgende week bevatten (`getGroceryMealEntries`). Daardoor is de oude
 * aanname "invalideer de lijst van het plan dat je wijzigt" niet meer
 * geldig: een gerecht wisselen op een avond in de volgende week raakt een
 * plan dat zelf helemaal geen lijst heeft, waarna de lijst van de huidige
 * week stilzwijgend op het oude gerecht bleef staan. Altijd allebei dus.
 */
/**
 * Zet de dagkeuze van de vólgende week terug nadat de boodschappen ervoor
 * naar het Picnic-mandje zijn overgedragen.
 *
 * Waarom alleen de volgende week? De boodschappenlijst hangt aan het weekplan
 * van de huidige week en wordt voor die week nooit meer vanaf nul opgebouwd
 * zonder dat de al overgedragen regels bewaard blijven — binnen deze week kan
 * er dus niets dubbel besteld worden, en blijft de dagkeuze gewoon tonen wat
 * de gebruiker gekozen heeft. Het risico zit één week verderop: een avond in
 * week W+1 die je in week W hebt aangevinkt en besteld, staat nog steeds op
 * "telt mee" zodra W+1 de huidige week wordt. Die week krijgt dan een verse
 * lijst — zónder de overdrachtsmarkeringen van de vorige bestelling — en zou
 * hetzelfde gerecht doodleuk opnieuw voorstellen.
 *
 * Bekende beperking: leeg je daarna je Picnic-mandje, dan komen de
 * overdrachtsmarkeringen terug maar deze keuze niet — welke avond bij welke
 * regel hoorde is nergens vastgelegd. De regels blijven wel gewoon op de
 * lijst staan; alleen een herbouw zou ze laten vervallen.
 */
export async function releaseNextWeekMealDays(householdId: string, weekStart: Date) {
  const nextWeekStart = new Date(weekStart);
  nextWeekStart.setDate(nextWeekStart.getDate() + 7);

  await prisma.mealPlanEntry.updateMany({
    where: {
      includedInGroceries: true,
      mealPlan: { householdId, weekStart: nextWeekStart },
    },
    data: { includedInGroceries: false },
  });
}

export async function invalidateShoppingListForPlanChange(householdId: string, changedMealPlanId: string) {
  const currentWeekPlan = await prisma.mealPlan.findUnique({
    where: { householdId_weekStart: { householdId, weekStart: getCurrentWeekStart() } },
    select: { id: true },
  });

  await invalidateShoppingList(changedMealPlanId);
  if (currentWeekPlan && currentWeekPlan.id !== changedMealPlanId) {
    await invalidateShoppingList(currentWeekPlan.id);
  }
}

export async function invalidateShoppingList(
  mealPlanId: string,
  options?: {
    /**
     * Laat de `ShoppingList`-rij zelf staan en bouw alleen de regels opnieuw
     * op. Nodig wanneer de aanroeper vanuit een scherm komt dat het id van
     * die lijst al in handen heeft (zoals de knoppen op /boodschappen): zou
     * de rij verdwijnen, dan wijst dat scherm naar een lijst die niet meer
     * bestaat en loopt de volgende klik stuk.
     */
    keepListRow?: boolean;
  }
) {
  // Twee soorten regels overleven een herbouw. Een al overgedragen regel,
  // want die ligt echt in het Picnic-mandje. En een handmatig toegevoegd
  // product: dat heeft niets met het weekmenu te maken, dus het zou een
  // stille verrassing zijn als "bananen" verdwijnt omdat je een gerecht
  // wisselt.
  const existing = await prisma.shoppingList.findUnique({
    where: { mealPlanId },
    include: {
      lines: { where: { OR: [{ transferredToPicnicAt: { not: null } }, { source: "MANUAL" }] } },
    },
  });

  if (!existing) return;
  if (existing.lines.length === 0 && !options?.keepListRow) {
    // Niets om te bewaren: weggooien is goedkoper dan herbouwen, en de
    // eerstvolgende `ensureShoppingList` maakt 'm gewoon opnieuw aan.
    await prisma.shoppingList.deleteMany({ where: { mealPlanId } });
    return;
  }

  const mealPlan = await prisma.mealPlan.findUniqueOrThrow({
    where: { id: mealPlanId },
    select: { householdId: true },
  });
  const { lines: rebuiltLines } = await buildShoppingListLines(mealPlanId, mealPlan.householdId);

  // Alleen de nog niet overgedragen regels vervangen. Een al overgedragen
  // regel blijft ongemoeid staan — ook als het weekmenu 'm niet meer nodig
  // heeft: hij ligt al in het mandje, dus de gebruiker moet 'm zien staan en
  // zelf kunnen beslissen (verwijderen uit de lijst of in Picnic laten).
  //
  // De sleutel is bewust (ingrediënt + bron + eenheid), niet het ingrediënt
  // alleen: één ingrediënt kan tegelijk een MEAL-regel (receptbehoefte) en
  // een FIXED-regel (vaste boodschap) hebben, en `aggregateMealNeeds` splitst
  // MEAL-regels bovendien per eenheid. Zou je alleen op ingrediënt matchen,
  // dan onderdrukt één overgedragen vaste boodschap stilzwijgend de hele
  // receptbehoefte van diezelfde week — precies wat er gebeurt na "Vaste
  // boodschappen (n)", dat alleen FIXED/MANUAL overdraagt (code-review-
  // bevinding, met een reproductie tegen de database aangetoond).
  const lineKey = (line: { ingredientId: string; source: string; unit: string }) =>
    `${line.ingredientId}:${line.source}:${line.unit}`;
  const keptKeys = new Set(existing.lines.map(lineKey));
  const newLines = rebuiltLines.filter((line) => !keptKeys.has(lineKey(line)));

  // Levert de herbouw nieuwe regels op, dan dekt een eerder gegeven
  // "bevestigd"/"ik heb besteld" die niet meer: de lijst bevat nu producten
  // die de gebruiker nooit heeft gezien en die zeker niet in de al geplaatste
  // bestelling zaten (AGENTS.md: nooit stilzwijgend of ongecontroleerd
  // bestellen). `orderConfirmedAt` wissen zorgt bovendien dat de herinnering
  // "rond je bestelling af in Picnic" weer verschijnt na een tweede
  // overdracht — zelfde redenering als bij `clearPicnicCart`.
  const hasNewReviewLines = newLines.some((line) => line.needsReview);

  await prisma.$transaction([
    prisma.shoppingListLine.deleteMany({
      where: {
        shoppingListId: existing.id,
        transferredToPicnicAt: null,
        source: { not: "MANUAL" },
      },
    }),
    prisma.shoppingListLine.createMany({
      data: newLines.map((line) => ({ ...line, shoppingListId: existing.id })),
    }),
    // Een bewaarde regel hield z'n "tekort geaccepteerd"-vlag vast, terwijl
    // het tekort door de weekwijziging juist groter kan zijn geworden. Bij een
    // verse regel stond die vlak altijd op false; dat gedrag hier gelijktrekken
    // zodat een groeiend tekort niet stilzwijgend verborgen blijft.
    prisma.shoppingListLine.updateMany({
      where: { shoppingListId: existing.id, shortfallAcknowledged: true },
      data: { shortfallAcknowledged: false },
    }),
    ...(newLines.length > 0
      ? [
          prisma.shoppingList.update({
            where: { id: existing.id },
            data: {
              orderConfirmedAt: null,
              ...(hasNewReviewLines
                ? {
                    status: "PREPARED" as const,
                    reviewedAt: null,
                    reviewFlaggedAt: existing.reviewFlaggedAt ?? new Date(),
                  }
                : {}),
            },
          }),
        ]
      : []),
  ]);
}

/**
 * Werkt een al-bestaande boodschappenlijst van deze week bij nadat een
 * voorraadstatus is gewijzigd. `ensureShoppingList` berekent maar één keer
 * per week — zonder deze functie zou een statuswijziging pas effect hebben
 * op een nieuw gegenereerde lijst (dus meestal pas volgende week), en zou
 * hij bovendien alle al bevestigde productkeuzes van deze week weggooien
 * als we in plaats daarvan de hele lijst opnieuw zouden opbouwen. Doet
 * niets als er nog geen weekplanning/lijst is — die wordt dan hoe dan ook
 * met de juiste (huidige) status opgebouwd.
 */
export async function syncShoppingListForInventoryChange(householdId: string, ingredientId: string) {
  const weekStart = getCurrentWeekStart();
  // Alleen het id: de maaltijden zelf komen hieronder uit
  // `getGroceryMealEntries`, dat óók de volgende week meeneemt. De oude,
  // zware include hield een "alleen deze week"-verzameling in scope — precies
  // het pad waarop de lijstopbouw en deze berekening uit elkaar konden lopen.
  const mealPlan = await prisma.mealPlan.findUnique({
    where: { householdId_weekStart: { householdId, weekStart } },
    select: { id: true },
  });
  if (!mealPlan) return;

  const shoppingList = await prisma.shoppingList.findUnique({
    where: { mealPlanId: mealPlan.id },
    include: { lines: true },
  });
  if (!shoppingList) return;

  const [ingredient, inventory, fixedGroceries, portionScaleForDate] = await Promise.all([
    prisma.ingredient.findUniqueOrThrow({ where: { id: ingredientId } }),
    getInventoryMap(householdId),
    prisma.fixedGrocery.findMany({ where: { householdId, ingredientId } }),
    getHouseholdPortionScaleForDate(householdId),
  ]);

  // Zelfde maaltijdenverzameling als de lijstopbouw (inclusief aangevinkte
  // avonden in de volgende week), anders zou een voorraadwijziging een regel
  // herberekenen op een andere behoefte dan waarmee die is aangemaakt.
  const { entries: groceryEntries } = await getGroceryMealEntries(mealPlan.id);

  let rawNeed: BaseQuantity | null = null;
  for (const entry of groceryEntries) {
    if (entry.skipped || !entry.includedInGroceries) continue;
    const scale = portionScaleForDate(entry.date).scale;
    for (const ri of entry.recipeVariant.recipe.ingredients) {
      if (ri.ingredientId !== ingredientId) continue;
      const scaledQuantity = ri.quantity * scale;
      rawNeed = rawNeed
        ? { amount: rawNeed.amount + scaledQuantity, unit: rawNeed.unit }
        : { amount: scaledQuantity, unit: ri.unit };
    }
  }

  const existingLine = shoppingList.lines.find((l) => l.ingredientId === ingredientId);

  if (rawNeed) {
    // Dit ingrediënt komt uit het weekmenu: voorraad kan de MEAL-regel
    // verlagen of laten vervallen, maar creëert er geen INVENTORY-regel bij.
    const net = netAfterInventory(rawNeed, ingredientId, inventory);
    if (existingLine && existingLine.source === "MEAL") {
      if (!net) {
        await prisma.shoppingListLine.delete({ where: { id: existingLine.id } });
      } else if (net.amount !== existingLine.quantity) {
        await prisma.shoppingListLine.update({ where: { id: existingLine.id }, data: { quantity: net.amount } });
      }
    } else if (!existingLine && net) {
      const match = await matchProductForIngredient(householdId, ingredientId);
      const fields = matchToLineFields(match);
      await prisma.shoppingListLine.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientId,
          quantity: net.amount,
          unit: net.unit,
          source: "MEAL",
          ...fields,
        },
      });
      await flagReviewNeeded(shoppingList.id, shoppingList.reviewFlaggedAt, fields.needsReview);
    }
    return;
  }

  // Geen recept deze week gebruikt dit ingrediënt: alleen relevant als het
  // ook geen vaste boodschap is (die regel blijft dan gewoon ongemoeid) en
  // het een voorraadcontrole-kandidaat is.
  if (fixedGroceries.length > 0 || !ingredient.likelyInStock) return;

  const status = inventory.get(ingredientId)?.status ?? "UNKNOWN";
  const shouldReplenish = status === "LOW" || status === "OUT_OF_STOCK";

  if (existingLine && existingLine.source === "INVENTORY" && !shouldReplenish) {
    await prisma.shoppingListLine.delete({ where: { id: existingLine.id } });
  } else if (!existingLine && shouldReplenish) {
    const match = await matchProductForIngredient(householdId, ingredientId);
    const products = await prisma.product.findMany({ where: { ingredientId } });
    const matchedProduct = products.find((c) => c.id === match.productId);
    await prisma.shoppingListLine.create({
      data: {
        shoppingListId: shoppingList.id,
        ingredientId,
        quantity: matchedProduct?.packageQuantity ?? 1,
        unit: ingredient.unit,
        source: "INVENTORY",
        ...matchToLineFields(match),
        needsReview: true,
      },
    });
    await flagReviewNeeded(shoppingList.id, shoppingList.reviewFlaggedAt, true);
  }
}

/**
 * WP69: een regel die na het aanmaken van de lijst alsnog controle nodig
 * krijgt (bijv. een nieuwe voorraadvraag) mag de "sinds wanneer staat
 * controle open"-klok niet overslaan — anders zou de attention-laag deze
 * situatie nooit tonen (die vereist een gezette `reviewFlaggedAt`).
 */
async function flagReviewNeeded(shoppingListId: string, currentlyFlaggedAt: Date | null, needsReview: boolean) {
  if (!needsReview || currentlyFlaggedAt) return;
  await prisma.shoppingList.update({ where: { id: shoppingListId }, data: { reviewFlaggedAt: new Date() } });
}

export async function getShoppingListCandidates(householdId: string, ingredientId: string) {
  const [products, rejectedMap] = await Promise.all([
    prisma.product.findMany({ where: { ingredientId } }),
    getRejectedProductIds(householdId, [ingredientId]),
  ]);
  const rejected = rejectedMap.get(ingredientId) ?? new Set<string>();
  return products.filter((p) => !rejected.has(p.id));
}

export async function getShoppingListCandidatesByIngredient(
  householdId: string,
  ingredientIds: string[]
) {
  const uniqueIngredientIds = Array.from(new Set(ingredientIds));
  if (uniqueIngredientIds.length === 0) return new Map<string, Awaited<ReturnType<typeof getShoppingListCandidates>>>();

  const [products, rejectedMap] = await Promise.all([
    prisma.product.findMany({ where: { ingredientId: { in: uniqueIngredientIds } } }),
    getRejectedProductIds(householdId, uniqueIngredientIds),
  ]);

  const candidatesByIngredient = new Map<string, typeof products>();
  for (const product of products) {
    if (!product.ingredientId) continue;
    const rejected = rejectedMap.get(product.ingredientId) ?? new Set<string>();
    if (rejected.has(product.id)) continue;
    const list = candidatesByIngredient.get(product.ingredientId) ?? [];
    list.push(product);
    candidatesByIngredient.set(product.ingredientId, list);
  }

  return candidatesByIngredient;
}

/**
 * FIXED- en MANUAL-regels laten de gebruiker direct een aantal verpakkingen
 * kiezen (het formulier op /boodschappen biedt een hoeveelheid + eenheid,
 * standaard 1×stuks) — in tegenstelling tot MEAL-regels, waar `quantity` een
 * ruwe receptbehoefte is die eerst door de verpakkingsengine moet. Als de
 * gebruiker daarbij "stuks" koos, is `quantity` dus al letterlijk het
 * gewenste aantal verpakkingen, ongeacht in welke eenheid (gram/ml/stuks)
 * het onderliggende ingrediënt eigenlijk gemeten wordt — de engine zou die
 * waarde anders proberen te herinterpreteren en op een te laag aantal
 * uitkomen (bewezen bug: een product van 1,5 liter met quantity=3 stuks gaf
 * via de engine maar 1 verpakking terug in plaats van 3). Gebruik deze
 * functie overal waar `describeLinePackaging` normaliter zou draaien, zodat
 * een toekomstige nieuwe regelbron met hetzelfde "gebruiker kiest zelf een
 * aantal"-gedrag niet opnieuw op deze valkuil stuit.
 */
export function isUserChosenPackageCount(line: { source: string; unit: string }): boolean {
  return (line.source === "FIXED" || line.source === "MANUAL") && line.unit === "PIECE";
}

/**
 * Vertaalt een boodschappenregel naar de verpakkingsberekening uit Fase 3
 * (aantal verpakkingen, totaal gekocht, verwacht overschot). `line.quantity`
 * is al de netto hoeveelheid (na aftrek van voorraad, zie ensureShoppingList),
 * dus die gaat rechtstreeks als behoefte de engine in. Geen enkele pagina
 * mag dit zelf uitrekenen — vandaar deze ene, gedeelde ingang.
 */
export function describeLinePackaging(
  line: { quantity: number; unit: Unit },
  product: { packageQuantity: number | null } | null | undefined
): PackageRequirementResult {
  return calculatePackageRequirement({
    recipeNeed: { amount: line.quantity, unit: line.unit },
    packageSize: product?.packageQuantity != null ? { amount: product.packageQuantity, unit: line.unit } : null,
  });
}

export interface ShoppingListShortfall {
  lineId: string;
  ingredientId: string;
  currentQuantity: number;
  neededQuantity: number;
  shortBy: number;
  unit: Unit;
}

// Floating-point-ruis (zie safeCeilDivision in packages.ts) mag nooit een
// regel als "tekort" bestempelen die in werkelijkheid exact klopt.
const SHORTFALL_EPSILON = 0.001;

/**
 * Vangnet tegen stilzwijgend onder-bestellen: een MEAL-regel kan na het
 * aanmaken van de lijst handmatig verlaagd zijn (via "Weektotaal aanpassen")
 * tot onder wat de geplande maaltijden deze week daadwerkelijk nodig hebben.
 * `describeLinePackaging`/`calculatePackageRequirement` rondt altijd naar
 * boven af, maar kan niet corrigeren voor een regel die al met een te lage
 * behoefte de berekening ingaat — dat moet hier expliciet gesignaleerd
 * worden in plaats van stilzwijgend "Compleet" te tonen.
 */
export function findShoppingListShortfalls(
  mealPlan: MealPlanWithEntries,
  portionScaleForDate: PortionScaleForDate,
  inventory: InventoryLookup,
  lines: Array<{ id: string; ingredientId: string; quantity: number; unit: Unit; source: string }>
): ShoppingListShortfall[] {
  const totals = aggregateMealNeeds(mealPlan, portionScaleForDate);
  const shortfalls: ShoppingListShortfall[] = [];
  for (const line of lines) {
    if (line.source !== "MEAL") continue;
    const agg = totals.get(`${line.ingredientId}:${line.unit}`);
    if (!agg) continue;
    const net = netAfterInventory({ amount: agg.quantity, unit: agg.unit }, line.ingredientId, inventory);
    const neededQuantity = net?.amount ?? 0;
    if (line.quantity < neededQuantity - SHORTFALL_EPSILON) {
      shortfalls.push({
        lineId: line.id,
        ingredientId: line.ingredientId,
        currentQuantity: line.quantity,
        neededQuantity,
        shortBy: Math.round((neededQuantity - line.quantity) * 100) / 100,
        unit: line.unit,
      });
    }
  }
  return shortfalls;
}
