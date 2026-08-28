/**
 * Pure samenvatting voor het bevestigingsscherm vóór het vullen van het
 * Picnic-mandje (Fase 7/8): hoeveel producten, een verwachte totaalprijs
 * (nooit doen alsof onbekende prijzen wél bekend zijn), welke regels
 * handmatig zijn aangepast, welke niet leverbaar zijn, en hoe oud de
 * prijscontrole is — zodat het gezin ziet wat er ongeveer gaat gebeuren
 * vóórdat er echt iets in het Picnic-mandje belandt.
 */
export type ConfirmationLineSource = "MEAL" | "FIXED" | "MANUAL" | "INVENTORY";

export interface ConfirmationLineInput {
  ingredientName: string;
  /** Waar komt deze regel vandaan? Bepaalt de uitsplitsing in het bevestigingsscherm. */
  source: ConfirmationLineSource;
  matchStatus: "MATCHED_TRUSTED" | "MATCHED_REVIEW_REQUIRED" | "NOT_FOUND" | "MANUALLY_SELECTED" | "UNAVAILABLE";
  transferredToPicnicAt: Date | null;
  packageCount?: number;
  product: {
    name: string;
    price: number | null;
    lastSeenAvailable: Date | null;
  } | null;
}

export interface ConfirmationSummary {
  productCount: number;
  alreadyTransferredCount: number;
  toTransferCount: number;
  /** Som van de bekende prijzen onder de nog over te dragen regels — een ondergrens, geen garantie. */
  expectedTotalPrice: number;
  unknownPriceCount: number;
  manuallySelected: string[];
  unavailable: string[];
  /** Oudste lastSeenAvailable onder de geprijsde producten die worden overgedragen, of null als er geen enkele bekend is. */
  oldestPriceCheck: Date | null;
  /**
   * Hoeveel van de over te dragen producten per herkomst. Zodat het
   * bevestigingsscherm geen enkel getal hoeft te tonen waarvan de gebruiker
   * niet kan zien waar het vandaan komt.
   */
  toTransferBySource: Record<ConfirmationLineSource, number>;
}

export function buildConfirmationSummary(lines: ConfirmationLineInput[]): ConfirmationSummary {
  const toTransfer = lines.filter((line) => !line.transferredToPicnicAt);

  let expectedTotalPrice = 0;
  let unknownPriceCount = 0;
  let oldestPriceCheck: Date | null = null;

  for (const line of toTransfer) {
    const price = line.product?.price ?? null;
    if (price === null) {
      unknownPriceCount += 1;
    } else {
      expectedTotalPrice += price * (line.packageCount ?? 1);
    }

    const seenAt = line.product?.lastSeenAvailable ?? null;
    if (seenAt && (oldestPriceCheck === null || seenAt < oldestPriceCheck)) {
      oldestPriceCheck = seenAt;
    }
  }

  return {
    productCount: lines.length,
    alreadyTransferredCount: lines.length - toTransfer.length,
    toTransferCount: toTransfer.length,
    expectedTotalPrice: Math.round(expectedTotalPrice * 100) / 100,
    unknownPriceCount,
    manuallySelected: toTransfer
      .filter((line) => line.matchStatus === "MANUALLY_SELECTED")
      .map((line) => line.ingredientName),
    unavailable: toTransfer
      .filter((line) => line.matchStatus === "NOT_FOUND" || line.matchStatus === "UNAVAILABLE")
      .map((line) => line.ingredientName),
    oldestPriceCheck,
    toTransferBySource: toTransfer.reduce<Record<ConfirmationLineSource, number>>(
      (counts, line) => {
        counts[line.source] += 1;
        return counts;
      },
      { MEAL: 0, FIXED: 0, MANUAL: 0, INVENTORY: 0 }
    ),
  };
}
