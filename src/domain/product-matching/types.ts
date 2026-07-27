/**
 * Statussen uit Fase 5 van het ontwerpdocument. MANUALLY_SELECTED wordt niet
 * door matchProduct() bepaald — dat is het resultaat van een expliciete
 * gebruikersactie op het Controle-scherm.
 */
export type MatchStatus =
  | "MATCHED_TRUSTED"
  | "MATCHED_REVIEW_REQUIRED"
  | "NOT_FOUND"
  | "MANUALLY_SELECTED"
  | "UNAVAILABLE";

export interface MatchCandidate {
  id: string;
  packageQuantity: number | null;
  lastSeenAvailable: Date | null;
  price: number | null;
}

export interface TrustedPreference {
  productId: string;
  timesChosen: number;
}

export interface ProductMatchInput {
  candidates: MatchCandidate[];
  trusted: TrustedPreference | null;
  rejectedProductIds: Set<string>;
  productChoicePreference?: "BALANCED" | "LOW_PRICE" | "KNOWN_PACKAGE";
  /** Injecteerbaar voor tests; default de echte huidige tijd. */
  now?: Date;
}

export interface ProductMatchResult {
  status: MatchStatus;
  productId: string | null;
  confidence: number;
  reasons: string[];
}
