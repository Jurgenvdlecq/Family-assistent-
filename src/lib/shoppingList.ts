import { prisma } from "./prisma";
import type { Unit, InventoryStatus } from "@/generated/prisma/enums";
import { getInventoryMap } from "./inventory";
import { subtractInventory } from "./quantity/inventory";
import { resolveInStockQuantity } from "./quantity/inventoryStatus";
import type { BaseQuantity } from "./quantity/units";
import { getCurrentWeekStart } from "./week";

type ProductCandidate = { id: string };
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

/**
 * Productkeuze volgt de prioriteitsregel uit sectie 10 van de Blueprint:
 * eerdere, expliciet vertrouwde keuze (Preference) wint altijd. Zonder zo'n
 * voorkeur en met meerdere kandidaat-producten is het een twijfelgeval
 * (needsReview) dat op het Controle-scherm om een keuze vraagt. Gedeeld
 * tussen receptregels (MEAL) en vaste boodschappen (FIXED) — dezelfde regel
 * geldt voor allebei.
 */
export function resolveProductChoice<T extends ProductCandidate>(
  candidates: T[],
  trustedProductIds: Set<string>
): { productId: string | null; needsReview: boolean } {
  const trusted = candidates.find((c) => trustedProductIds.has(c.id));
  if (trusted) return { productId: trusted.id, needsReview: false };
  if (candidates.length === 1) return { productId: candidates[0].id, needsReview: false };
  if (candidates.length > 1) {
    return { productId: candidates[0].id, needsReview: true }; // voorlopige suggestie, gebruiker beslist
  }
  return { productId: null, needsReview: true }; // geen product gevonden — ook een twijfelgeval
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

  const [allCandidates, productPreferences] = await Promise.all([
    prisma.product.findMany({ where: { ingredientId: { in: Array.from(ingredientIds) } } }),
    prisma.preference.findMany({
      where: {
        ownerType: "HOUSEHOLD",
        ownerId: householdId,
        subjectType: "PRODUCT",
        stance: "LIKED",
      },
    }),
  ]);

  const candidatesByIngredient = new Map<string, typeof allCandidates>();
  for (const product of allCandidates) {
    if (!product.ingredientId) continue;
    const list = candidatesByIngredient.get(product.ingredientId) ?? [];
    list.push(product);
    candidatesByIngredient.set(product.ingredientId, list);
  }
  const trustedProductIds = new Set(productPreferences.map((p) => p.subjectId));

  // Voorraad aftrekken (Fase 3): een ingrediënt dat als "genoeg op voorraad"
  // is gemarkeerd, verlaagt of schrapt de receptbehoefte voor deze week.
  const mealLines = Array.from(totals.values())
    .map((t) => {
      const net = netAfterInventory({ amount: t.quantity, unit: t.unit }, t.ingredientId, inventory);
      if (!net) return null;
      const { productId, needsReview } = resolveProductChoice(
        candidatesByIngredient.get(t.ingredientId) ?? [],
        trustedProductIds
      );
      return {
        ingredientId: t.ingredientId,
        productId,
        quantity: net.amount,
        unit: net.unit,
        source: "MEAL" as const,
        needsReview,
      };
    })
    .filter((line) => line !== null);

  const inventoryLines = lowStockToReplenish.map((ing) => {
    const candidates = candidatesByIngredient.get(ing.id) ?? [];
    const { productId } = resolveProductChoice(candidates, trustedProductIds);
    const matchedProduct = candidates.find((c) => c.id === productId);
    return {
      ingredientId: ing.id,
      productId,
      quantity: matchedProduct?.packageQuantity ?? 1,
      unit: ing.unit,
      source: "INVENTORY" as const,
      // Altijd controleren: de gebruiker gaf alleen een status door
      // ("bijna op"), geen exacte hoeveelheid.
      needsReview: true,
    };
  });

  const fixedLines = fixedGroceries.map((fixed) => {
    const { productId, needsReview } = resolveProductChoice(
      candidatesByIngredient.get(fixed.ingredientId) ?? [],
      trustedProductIds
    );
    return {
      ingredientId: fixed.ingredientId,
      productId,
      quantity: fixed.quantity,
      unit: fixed.unit,
      source: "FIXED" as const,
      needsReview,
    };
  });

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

  async function resolveProductForIngredient() {
    const [candidates, productPreferences] = await Promise.all([
      prisma.product.findMany({ where: { ingredientId } }),
      prisma.preference.findMany({
        where: { ownerType: "HOUSEHOLD", ownerId: householdId, subjectType: "PRODUCT", stance: "LIKED" },
      }),
    ]);
    return { candidates, ...resolveProductChoice(candidates, new Set(productPreferences.map((p) => p.subjectId))) };
  }

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
      const { productId, needsReview } = await resolveProductForIngredient();
      await prisma.shoppingListLine.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientId,
          productId,
          quantity: net.amount,
          unit: net.unit,
          source: "MEAL",
          needsReview,
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
    const { candidates, productId } = await resolveProductForIngredient();
    const matchedProduct = candidates.find((c) => c.id === productId);
    await prisma.shoppingListLine.create({
      data: {
        shoppingListId: shoppingList.id,
        ingredientId,
        productId,
        quantity: matchedProduct?.packageQuantity ?? 1,
        unit: ingredient.unit,
        source: "INVENTORY",
        needsReview: true,
      },
    });
  }
}

export async function getShoppingListCandidates(ingredientId: string) {
  return prisma.product.findMany({ where: { ingredientId } });
}
