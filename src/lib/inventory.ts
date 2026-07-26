import { prisma } from "./prisma";
import type { InventoryStatus } from "@/generated/prisma/enums";

/**
 * De ingrediënten waar de voorraadcontrole (Fase 4) naar vraagt — pantry-
 * basisproducten die waarschijnlijk al in huis zijn — samen met de huidige
 * status van dit huishouden (UNKNOWN als er nog nooit iets is ingevuld).
 * Blijft, in tegenstelling tot Picnic-besteller, gewoon bewaard tussen
 * weken: geen reset.
 */
export async function getInventoryChecklist(householdId: string) {
  const ingredients = await prisma.ingredient.findMany({
    where: { likelyInStock: true },
    orderBy: { name: "asc" },
    include: {
      inventoryItems: { where: { householdId } },
    },
  });

  return ingredients.map((ingredient) => ({
    ingredientId: ingredient.id,
    name: ingredient.name,
    status: ingredient.inventoryItems[0]?.status ?? ("UNKNOWN" as InventoryStatus),
  }));
}

export async function setInventoryStatus(
  householdId: string,
  ingredientId: string,
  status: InventoryStatus
) {
  return prisma.inventoryItem.upsert({
    where: { householdId_ingredientId: { householdId, ingredientId } },
    update: { status },
    create: { householdId, ingredientId, status },
  });
}

/** Alle voorraadregels van een huishouden, voor gebruik bij het opbouwen van de boodschappenlijst. */
export async function getInventoryMap(householdId: string) {
  const items = await prisma.inventoryItem.findMany({ where: { householdId } });
  return new Map(items.map((item) => [item.ingredientId, item]));
}
