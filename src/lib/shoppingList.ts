import { prisma } from "./prisma";
import type { Unit, InventoryStatus } from "@/generated/prisma/enums";
import { getInventoryMap } from "./inventory";
import { subtractInventory } from "./quantity/inventory";
import { resolveInStockQuantity } from "./quantity/inventoryStatus";
import type { BaseQuantity } from "./quantity/units";
import { getCurrentWeekStart } from "./week";
import { matchProduct } from "@/domain/product-matching/matchProduct";
import { matchProductForIngredient } from "@/domain/product-matching/matchIngredient";
import { getRejectedProductIds, getTrustedPreferences, toMatchCandidate } from "@/domain/product-matching/repository";
import type { ProductMatchResult } from "@/domain/product-matching/types";

type InventoryLookup = Awaited<ReturnType<typeof getInventoryMap>>;

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

  const [mealPlan, fixedGroceries, inventory, likelyInStockIngredients] = await Promise.all([
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
  ]);

  type Agg = { ingredientId: string; quantity: number; unit: Unit };
  const totals = new Map<string, Agg>();
  for (const entry of mealPlan.entries) {
    for (const ri of entry.recipeVariant.recipe.ingredients) {
      const key = `${ri.ingredientId}:${ri.unit}`;
      const current = totals.get(key);
      if (current) {
        current.quantity += ri.quantity;
      } else {
        totals.set(key, { ingredientId: ri.ingredientId, quantity: ri.quantity, unit: ri.unit });
      }
    }
  }

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

  const [ingredient, inventory, fixedGroceries] = await Promise.all([
    prisma.ingredient.findUniqueOrThrow({ where: { id: ingredientId } }),
    getInventoryMap(householdId),
    prisma.fixedGrocery.findMany({ where: { householdId, ingredientId } }),
  ]);

  let rawNeed: BaseQuantity | null = null;
  for (const entry of mealPlan.entries) {
    for (const ri of entry.recipeVariant.recipe.ingredients) {
      if (ri.ingredientId !== ingredientId) continue;
      rawNeed = rawNeed
        ? { amount: rawNeed.amount + ri.quantity, unit: rawNeed.unit }
        : { amount: ri.quantity, unit: ri.unit };
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
