import { prisma } from "./prisma";
import type { Unit, InventoryStatus } from "@/generated/prisma/enums";
import { getInventoryMap } from "./inventory";
import { subtractInventory } from "./quantity/inventory";
import { resolveInStockQuantity } from "./quantity/inventoryStatus";
import type { BaseQuantity } from "./quantity/units";
import { getCurrentWeekStart, DAY_KEY_BY_ENUM, type DayKey } from "./week";
import { getHouseholdPortionScaleByDay } from "./household";
import { matchProduct } from "@/domain/product-matching/matchProduct";
import { matchProductForIngredient } from "@/domain/product-matching/matchIngredient";
import { getRejectedProductIds, getTrustedPreferences, toMatchCandidate } from "@/domain/product-matching/repository";
import type { ProductMatchResult } from "@/domain/product-matching/types";
import { productChoicePreferenceFromDeliveryPreference } from "@/domain/product-matching/productChoicePreference";
import { calculatePackageRequirement, type PackageRequirementResult } from "./quantity/packages";
import type { DayOfWeek } from "@/generated/prisma/enums";

type InventoryLookup = Awaited<ReturnType<typeof getInventoryMap>>;
type PortionScaleByDay = Record<DayKey, { scale: number }>;

// Bewust een minimale, structurele vorm i.p.v. het volledige Prisma-payload-
// type van getMealPlanForWeek: dit is alles wat de behoefteberekening nodig
// heeft, en maakt hem in tests met eenvoudige literals te vullen.
interface MealPlanWithEntries {
  entries: Array<{
    dayOfWeek: DayOfWeek;
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
  portionScaleByDay: PortionScaleByDay
): Map<string, { ingredientId: string; quantity: number; unit: Unit }> {
  const totals = new Map<string, { ingredientId: string; quantity: number; unit: Unit }>();
  for (const entry of mealPlan.entries) {
    const dayKey = DAY_KEY_BY_ENUM[entry.dayOfWeek];
    const scale = portionScaleByDay[dayKey]?.scale ?? 1;
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

  const [mealPlan, fixedGroceries, inventory, likelyInStockIngredients, portionScaleByDay, household] = await Promise.all([
    prisma.mealPlan.findUniqueOrThrow({
      where: { id: mealPlanId },
      include: {
        entries: {
          include: {
            recipeVariant: {
              include: {
                recipe: { include: { ingredients: { include: { ingredient: true } } } },
              },
            },
          },
        },
      },
    }),
    prisma.fixedGrocery.findMany({ where: { householdId } }),
    getInventoryMap(householdId),
    prisma.ingredient.findMany({ where: { likelyInStock: true }, select: { id: true, unit: true } }),
    getHouseholdPortionScaleByDay(householdId),
    prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: { deliveryPreference: true } }),
  ]);
  const productChoicePreference = productChoicePreferenceFromDeliveryPreference(household.deliveryPreference);

  const totals = aggregateMealNeeds(mealPlan, portionScaleByDay);

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

  return prisma.shoppingList.create({
    data: {
      mealPlanId,
      status: "PREPARED",
      lines: { create: [...mealLines, ...fixedLines, ...inventoryLines] },
    },
    include: {
      lines: { include: { ingredient: true, product: true } },
    },
  });
}

/** Wordt aangeroepen als de weekplanning wijzigt — de lijst moet dan opnieuw berekend worden. */
export async function invalidateShoppingList(mealPlanId: string) {
  await prisma.shoppingList.deleteMany({ where: { mealPlanId } });
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
  const mealPlan = await prisma.mealPlan.findUnique({
    where: { householdId_weekStart: { householdId, weekStart } },
    include: {
      entries: { include: { recipeVariant: { include: { recipe: { include: { ingredients: true } } } } } },
    },
  });
  if (!mealPlan) return;

  const shoppingList = await prisma.shoppingList.findUnique({
    where: { mealPlanId: mealPlan.id },
    include: { lines: true },
  });
  if (!shoppingList) return;

  const [ingredient, inventory, fixedGroceries, portionScaleByDay] = await Promise.all([
    prisma.ingredient.findUniqueOrThrow({ where: { id: ingredientId } }),
    getInventoryMap(householdId),
    prisma.fixedGrocery.findMany({ where: { householdId, ingredientId } }),
    getHouseholdPortionScaleByDay(householdId),
  ]);

  let rawNeed: BaseQuantity | null = null;
  for (const entry of mealPlan.entries) {
    const dayKey = DAY_KEY_BY_ENUM[entry.dayOfWeek];
    const scale = portionScaleByDay[dayKey]?.scale ?? 1;
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
      await prisma.shoppingListLine.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientId,
          quantity: net.amount,
          unit: net.unit,
          source: "MEAL",
          ...matchToLineFields(match),
        },
      });
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
  }
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
  portionScaleByDay: PortionScaleByDay,
  inventory: InventoryLookup,
  lines: Array<{ id: string; ingredientId: string; quantity: number; unit: Unit; source: string }>
): ShoppingListShortfall[] {
  const totals = aggregateMealNeeds(mealPlan, portionScaleByDay);
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
