import type { ProductProvider } from "@/generated/prisma/enums";
import { countsAsHardMatch, EQUIVALENCE_LABELS, type EquivalenceLevel } from "./equivalence";
import type { BasketLineResult } from "./basketComparison";

/**
 * Eén regel naast elkaar bij alle winkels — Picnic incluis.
 *
 * Tot nu toe was Picnic "de referentie" en stonden de winkels daar los onder.
 * Voor de vraag "wat kost dit hier, en daar?" is dat onhandig: je wilt de
 * bedragen naast elkaar zien. Deze functie maakt van een doorgerekende regel
 * een rij cellen, één per winkel, in een vaste volgorde.
 *
 * Wat er níét verandert is welk bedrag er in een cel staat: dat blijft de
 * kosten van wat je déze week nodig hebt, in hele verpakkingen. Drie bedragen
 * naast elkaar zijn alleen eerlijk als ze alle drie op dezelfde manier zijn
 * uitgerekend.
 */

export interface StoreCell {
  provider: ProductProvider;
  /** Wat deze regel hier kost; `null` als we het niet weten. */
  cost: number | null;
  packagesToBuy: number | null;
  packageSize: string | null;
  productName: string | null;
  /** `null` bij Picnic: dat ís het product waarmee vergeleken wordt. */
  level: EquivalenceLevel | null;
  /** Waarom er geen bedrag staat, of waarom het niet meetelt. */
  note: string | null;
  /** Goedkoopste van de vergelijkbare cellen. */
  cheapest: boolean;
  promoLabel: string | null;
  stale: boolean;
}

/**
 * Zet de regel om naar cellen, in de meegegeven volgorde van winkels.
 *
 * De "goedkoopste"-markering krijgt alleen een cel die je ook echt zo mag
 * vergelijken: Picnic zelf, of een winkel met een identiek of gelijkwaardig
 * product. Een alternatief kan lager uitvallen en wordt nooit gekroond — dat
 * is de kern van het equivalentiemodel: goedkoper door iets anders te kopen is
 * geen besparing.
 *
 * En als alleen Picnic een prijs heeft, wordt er niets gemarkeerd. "Het
 * goedkoopst" met één deelnemer is geen vergelijking.
 */
export function compareLineAcrossStores(
  line: BasketLineResult,
  providers: ProductProvider[]
): StoreCell[] {
  const cells: StoreCell[] = [
    {
      provider: "PICNIC",
      cost: line.referenceCost,
      packagesToBuy: line.referencePackages,
      packageSize: null,
      productName: line.referenceName,
      level: null,
      note: line.referenceName === null ? "nog geen product gekozen" : line.referenceCost === null ? "prijs onbekend" : null,
      cheapest: false,
      promoLabel: null,
      stale: false,
    },
  ];

  for (const provider of providers) {
    const store = line.stores.get(provider);
    if (!store) {
      cells.push({
        provider,
        cost: null,
        packagesToBuy: null,
        packageSize: null,
        productName: null,
        level: null,
        // Nadrukkelijk niet € 0: niet gevonden is iets anders dan gratis.
        note: "niet gevonden",
        cheapest: false,
        promoLabel: null,
        stale: false,
      });
      continue;
    }

    cells.push({
      provider,
      cost: store.cost,
      packagesToBuy: store.packagesToBuy,
      packageSize: store.packageSize,
      productName: store.name,
      level: store.level,
      note: store.missingReason ?? (store.level === "ALTERNATIEF" ? EQUIVALENCE_LABELS.ALTERNATIEF : null),
      cheapest: false,
      promoLabel: store.promoLabel,
      stale: store.stale,
    });
  }

  const comparable = cells.filter(
    (cell) => cell.cost !== null && (cell.provider === "PICNIC" ? cell.note === null : cell.level !== null && countsAsHardMatch(cell.level))
  );
  // Eén deelnemer is geen vergelijking.
  if (comparable.length >= 2) {
    const lowest = Math.min(...comparable.map((cell) => cell.cost!));
    for (const cell of comparable) {
      if (Math.abs(cell.cost! - lowest) < 0.005) cell.cheapest = true;
    }
  }

  return cells;
}

/** De volgorde waarin de winkels op het scherm staan; Picnic altijd eerst. */
export function comparisonColumns(providers: ProductProvider[]): ProductProvider[] {
  return ["PICNIC", ...providers.filter((provider) => provider !== "PICNIC")];
}
