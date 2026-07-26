import type { BaseQuantity } from "./units";

/**
 * Netto benodigde hoeveelheid = receptbehoefte minus wat al op voorraad is,
 * nooit negatief (op is op, maar we "bestellen" niet in de min).
 */
export function subtractInventory(needed: BaseQuantity, inStock: BaseQuantity): BaseQuantity {
  if (needed.unit !== inStock.unit) {
    throw new Error(
      `Kan voorraad niet aftrekken: eenheden komen niet overeen (${needed.unit} vs ${inStock.unit}).`
    );
  }
  if (!Number.isFinite(needed.amount) || !Number.isFinite(inStock.amount)) {
    throw new Error("Ongeldige hoeveelheid bij het aftrekken van voorraad.");
  }
  return { amount: Math.max(0, needed.amount - inStock.amount), unit: needed.unit };
}

/** Schaalt een receptbehoefte op van het aantal personen waarvoor het recept bedoeld is naar het werkelijke aantal eters. */
export function scaleQuantityForPersons(
  base: BaseQuantity,
  basePersons: number,
  targetPersons: number
): BaseQuantity {
  if (basePersons <= 0 || targetPersons < 0) {
    throw new Error(
      `Ongeldig aantal personen om op te schalen (basis: ${basePersons}, doel: ${targetPersons}).`
    );
  }
  if (!Number.isFinite(base.amount)) {
    throw new Error(`Ongeldige hoeveelheid: ${base.amount}`);
  }
  return { amount: (base.amount * targetPersons) / basePersons, unit: base.unit };
}
