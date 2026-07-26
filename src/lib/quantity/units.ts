import type { Unit } from "@/generated/prisma/enums";

/**
 * Eenheden zoals een gebruiker of Picnic ze aanlevert (kilogram, liter) zijn
 * ruimer dan de eenheden die we in de database opslaan (Unit: alleen GRAM,
 * ML, PIECE — zie AGENTS.md Fase 2). Alle berekeningen in dit domein werken
 * daarom op de database-eenheid; deze module converteert ernaartoe.
 */
export type ExtendedUnit = Unit | "KILOGRAM" | "LITER";

export interface Quantity {
  amount: number;
  unit: ExtendedUnit;
}

/** Een hoeveelheid die al in de database-eenheid staat (GRAM, ML of PIECE). */
export interface BaseQuantity {
  amount: number;
  unit: Unit;
}

const CONVERSION: Record<ExtendedUnit, { base: Unit; factor: number }> = {
  GRAM: { base: "GRAM", factor: 1 },
  KILOGRAM: { base: "GRAM", factor: 1000 },
  ML: { base: "ML", factor: 1 },
  LITER: { base: "ML", factor: 1000 },
  PIECE: { base: "PIECE", factor: 1 },
};

function assertFiniteAmount(amount: number): void {
  if (!Number.isFinite(amount)) {
    throw new Error(`Ongeldige hoeveelheid: ${amount}`);
  }
}

/** Zet een hoeveelheid in kilogram/liter om naar de bijbehorende basis-eenheid (gram/ml); gram/ml/stuks blijven ongewijzigd. */
export function toBaseUnit(quantity: Quantity): BaseQuantity {
  assertFiniteAmount(quantity.amount);
  const conversion = CONVERSION[quantity.unit];
  if (!conversion) {
    throw new Error(`Onbekende eenheid: ${quantity.unit}`);
  }
  return { amount: quantity.amount * conversion.factor, unit: conversion.base };
}

/**
 * Telt hoeveelheden van dezelfde ingrediënt-eenheid bij elkaar op — bv. de
 * behoefte van meerdere recepten die in dezelfde week hetzelfde ingrediënt
 * gebruiken. Verschillende eenheden combineren is een fout in de aanroeper,
 * geen situatie om stilzwijgend te negeren.
 */
export function combineQuantities(items: BaseQuantity[]): BaseQuantity {
  if (items.length === 0) {
    throw new Error("Kan geen hoeveelheden combineren: lege lijst.");
  }
  const unit = items[0].unit;
  let total = 0;
  for (const item of items) {
    if (item.unit !== unit) {
      throw new Error(
        `Kan hoeveelheden met verschillende eenheden niet combineren: ${unit} en ${item.unit}.`
      );
    }
    assertFiniteAmount(item.amount);
    if (item.amount < 0) {
      throw new Error(`Ongeldige hoeveelheid: ${item.amount}`);
    }
    total += item.amount;
  }
  return { amount: total, unit };
}
