import type { BaseQuantity } from "./units";
import { subtractInventory } from "./inventory";

export type PackageRequirementStatus = "OK" | "NOTHING_NEEDED" | "PACKAGE_UNKNOWN";

export interface PackageRequirementInput {
  /** Wat de gekozen recepten deze week nodig hebben, vóór aftrek van voorraad. */
  recipeNeed: BaseQuantity;
  /** Wat er al in huis is. Default: niets. */
  inStock?: BaseQuantity;
  /**
   * Hoeveel van de basis-eenheid er in één verpakking zit (bv. 500 gram).
   * `null` wanneer dit niet betrouwbaar bekend is (zie
   * src/lib/quantity/parsePackageSize.ts) — dan kan het aantal te bestellen
   * verpakkingen niet berekend worden en is handmatige controle nodig.
   */
  packageSize: BaseQuantity | null;
}

export interface PackageRequirementResult {
  status: PackageRequirementStatus;
  recipeNeed: BaseQuantity;
  netNeeded: BaseQuantity;
  packageSize: BaseQuantity | null;
  packagesToBuy: number;
  totalPurchased: BaseQuantity | null;
  expectedSurplus: BaseQuantity | null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Deelt af naar boven, maar poetst eerst floating-point-ruis weg (bv. 0.3/0.1 = 2.9999999999999996 in JS) zodat dat niet tot een overbodige extra verpakking leidt. */
function safeCeilDivision(numerator: number, denominator: number): number {
  const ratio = numerator / denominator;
  const rounded = Math.round(ratio * 1e6) / 1e6;
  return Math.ceil(rounded);
}

/**
 * De centrale verpakkingsberekening uit Fase 3 van het ontwerpdocument.
 * Voorbeeld: 900 gram penne nodig, 100 gram op voorraad, verpakking van
 * 500 gram -> netto 800 gram nodig, 2 verpakkingen, 1000 gram gekocht,
 * 200 gram over.
 */
export function calculatePackageRequirement(
  input: PackageRequirementInput
): PackageRequirementResult {
  const { recipeNeed, packageSize } = input;

  if (!Number.isFinite(recipeNeed.amount) || recipeNeed.amount < 0) {
    throw new Error(`Ongeldige receptbehoefte: ${recipeNeed.amount}`);
  }

  const inStock = input.inStock ?? { amount: 0, unit: recipeNeed.unit };
  const netNeeded = subtractInventory(recipeNeed, inStock);

  if (netNeeded.amount === 0) {
    return {
      status: "NOTHING_NEEDED",
      recipeNeed,
      netNeeded,
      packageSize,
      packagesToBuy: 0,
      totalPurchased: { amount: 0, unit: netNeeded.unit },
      expectedSurplus: { amount: 0, unit: netNeeded.unit },
    };
  }

  if (!packageSize) {
    return {
      status: "PACKAGE_UNKNOWN",
      recipeNeed,
      netNeeded,
      packageSize: null,
      packagesToBuy: 0,
      totalPurchased: null,
      expectedSurplus: null,
    };
  }

  if (packageSize.unit !== netNeeded.unit) {
    throw new Error(
      `Verpakkingsgrootte staat in een andere eenheid dan de behoefte (${packageSize.unit} vs ${netNeeded.unit}).`
    );
  }
  if (!Number.isFinite(packageSize.amount) || packageSize.amount <= 0) {
    throw new Error(`Ongeldige verpakkingsgrootte: ${packageSize.amount}`);
  }

  const packagesToBuy = safeCeilDivision(netNeeded.amount, packageSize.amount);
  const totalPurchasedAmount = round2(packagesToBuy * packageSize.amount);
  const expectedSurplusAmount = round2(totalPurchasedAmount - netNeeded.amount);

  return {
    status: "OK",
    recipeNeed,
    netNeeded,
    packageSize,
    packagesToBuy,
    totalPurchased: { amount: totalPurchasedAmount, unit: netNeeded.unit },
    expectedSurplus: { amount: expectedSurplusAmount, unit: netNeeded.unit },
  };
}
