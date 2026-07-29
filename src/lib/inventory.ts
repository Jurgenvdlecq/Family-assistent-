import { prisma } from "./prisma";
import type { InventoryStatus } from "@/generated/prisma/enums";

// Hoelang een eerder "genoeg"-antwoord nog geldig blijft voordat de
// voorraadcheck er opnieuw kort naar vraagt (DATAMODEL_AUDIT.md, punt 8:
// voorraad moet niet als permanente administratie voelen). Geen nieuw
// model nodig — InventoryItem.updatedAt bestaat al.
const INVENTORY_RECHECK_AFTER_DAYS = 21;

/**
 * Of dit voorraadantwoord deze week weer om aandacht vraagt. Nog nooit
 * ingevuld (UNKNOWN) of "bijna op"/"op" vraagt altijd om een blik — dat is
 * relevant voor de boodschappenlijst. "Genoeg" blijft geldig tot het te
 * lang geleden is; zo hoeft de gebruiker niet elke week hetzelfde
 * basisproduct opnieuw te bevestigen.
 */
export function needsInventoryAttention(
  status: InventoryStatus,
  updatedAt: Date | null,
  now: Date = new Date()
): boolean {
  if (status !== "SUFFICIENT") return true;
  if (!updatedAt) return true;
  const daysSinceUpdate = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceUpdate >= INVENTORY_RECHECK_AFTER_DAYS;
}

/**
 * De ingrediënten waar de voorraadcontrole (Fase 4) naar vraagt — pantry-
 * basisproducten die waarschijnlijk al in huis zijn — samen met de huidige
 * status van dit huishouden (UNKNOWN als er nog nooit iets is ingevuld).
 * Blijft, in tegenstelling tot Picnic-besteller, gewoon bewaard tussen
 * weken: geen reset. `needsAttention` scheidt wat deze week echt een
 * check verdient van wat recent al bevestigd is (zie `needsInventoryAttention`).
 */
export async function getInventoryChecklist(householdId: string) {
  const ingredients = await prisma.ingredient.findMany({
    where: { likelyInStock: true },
    orderBy: { name: "asc" },
    include: {
      inventoryItems: { where: { householdId } },
    },
  });

  return ingredients.map((ingredient) => {
    const item = ingredient.inventoryItems[0];
    const status = item?.status ?? ("UNKNOWN" as InventoryStatus);
    return {
      ingredientId: ingredient.id,
      name: ingredient.name,
      status,
      needsAttention: needsInventoryAttention(status, item?.updatedAt ?? null),
    };
  });
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
