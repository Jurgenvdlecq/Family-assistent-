import type { InventoryStatus } from "@/generated/prisma/enums";
import type { BaseQuantity } from "./units";

/**
 * Vertaalt een voorraadstatus naar een hoeveelheid die "voorraad aftrekken"
 * (subtractInventory) kan gebruiken. Zonder expliciet ingevoerde hoeveelheid
 * is dit een bewuste aanname, geen meting:
 * - SUFFICIENT ("genoeg"): we nemen aan dat dit de volledige receptbehoefte
 *   dekt — er hoeft dan niets bijgekocht te worden voor dit ingrediënt.
 * - LOW/OUT_OF_STOCK/UNKNOWN: geen aanname, de volledige behoefte blijft
 *   staan (liever een keer te veel op de lijst dan een tekort in de keuken).
 */
export function resolveInStockQuantity(
  status: InventoryStatus,
  explicit: BaseQuantity | null,
  recipeNeed: BaseQuantity
): BaseQuantity {
  if (explicit) {
    if (explicit.unit !== recipeNeed.unit) {
      throw new Error(
        `Voorraadhoeveelheid staat in een andere eenheid dan de behoefte (${explicit.unit} vs ${recipeNeed.unit}).`
      );
    }
    return explicit;
  }
  if (status === "SUFFICIENT") return recipeNeed;
  return { amount: 0, unit: recipeNeed.unit };
}
