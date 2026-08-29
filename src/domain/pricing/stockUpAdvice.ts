import { derivePreservation } from "./qualityTier";

/**
 * Loont het om extra in te slaan?
 *
 * Alleen bij een echte korting, alleen bij iets wat lang goed blijft, en
 * altijd met een maximum. De faalwijze die dit moet voorkomen is bekend: een
 * kast vol met zes potten pindakaas omdat ze "in de aanbieding" waren, waarvan
 * de helft over de datum gaat. Weggegooid eten is de duurste besparing die er
 * is.
 */

/** Nooit meer dan dit aantal extra verpakkingen adviseren. */
export const MAX_EXTRA_PACKAGES = 3;

/** Onder dit bedrag is inslaan de moeite (en de kastruimte) niet waard. */
export const MIN_STOCK_UP_SAVING = 1.5;

export interface StockUpInput {
  ingredientName: string;
  productName: string;
  /** Hoeveel verpakkingen je deze week sowieso koopt. */
  packagesThisWeek: number;
  /** Wat één verpakking nu kost. */
  pricePerPackage: number;
  /** Wat één verpakking normaal kost; `null` als we dat niet weten. */
  typicalPricePerPackage: number | null;
  /** Hoeveel er al in huis is, in de eenheid van het ingrediënt. */
  inStock: number;
  /** Wat er in één verpakking zit; `null` als dat onbekend is. */
  packageQuantity: number | null;
  /** Blijft dit lang goed? Wordt afgeleid uit de naam als het niet is meegegeven. */
  shelfStable?: boolean;
}

export interface StockUpAdvice {
  ingredientName: string;
  productName: string;
  extraPackages: number;
  saving: number;
  reason: string;
}

/**
 * Hoort dit product in het hamsteradvies?
 *
 * `null` betekent "nee, en daar hoeft niets over gezegd te worden". Vier
 * redenen om te zwijgen, en ze zijn allemaal een echte faalwijze:
 *
 * 1. **Geen bekende normale prijs.** Zonder geschiedenis weet je niet of dit
 *    een korting is. Dan is "sla in" een gok met het geld van de gebruiker.
 * 2. **Niet houdbaar.** Verse producten inslaan is eten weggooien met een
 *    omweg.
 * 3. **Te weinig voordeel.** Kastruimte en geld vastleggen voor een halve euro
 *    is geen advies.
 * 4. **Al genoeg in huis.** Het voorraadmodel weet dit al; er nog eens drie
 *    potten bij adviseren is precies de kast vol pindakaas.
 */
export function adviseStockUp(input: StockUpInput): StockUpAdvice | null {
  if (input.typicalPricePerPackage === null) return null;

  const shelfStable =
    input.shelfStable ?? derivePreservation(`${input.productName} ${input.ingredientName}`) !== "VERS";
  if (!shelfStable) return null;

  const savingPerPackage = Number((input.typicalPricePerPackage - input.pricePerPackage).toFixed(2));
  if (savingPerPackage < 0.01) return null;

  // Al ruim voorzien? Dan niets. "Ruim" is hier: meer in huis dan je deze week
  // koopt — dan ligt de kast al vol genoeg.
  if (input.packageQuantity !== null && input.packageQuantity > 0) {
    const packagesInStock = input.inStock / input.packageQuantity;
    if (packagesInStock >= input.packagesThisWeek) return null;
  }

  const extraPackages = Math.min(MAX_EXTRA_PACKAGES, Math.max(1, input.packagesThisWeek));
  const saving = Number((extraPackages * savingPerPackage).toFixed(2));
  if (saving < MIN_STOCK_UP_SAVING) return null;

  return {
    ingredientName: input.ingredientName,
    productName: input.productName,
    extraPackages,
    saving,
    reason: `normaal € ${input.typicalPricePerPackage.toFixed(2).replace(".", ",")}, nu € ${input.pricePerPackage
      .toFixed(2)
      .replace(".", ",")} — en dit blijft lang goed`,
  };
}
