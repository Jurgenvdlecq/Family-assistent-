import { normalizeProductChoicePreference } from "./productChoicePreference";
import type { MatchCandidate, ProductMatchInput, ProductMatchResult, TrustedPreference } from "./types";

/**
 * Na hoeveel dagen zonder bevestigde beschikbaarheid een product niet meer
 * als "beschikbaar" wordt beschouwd. Een vaste, uitlegbare grens in plaats
 * van te doen alsof we live beschikbaarheid weten (dat komt pas met de
 * echte Picnic-integratie in latere fases).
 */
const AVAILABILITY_WINDOW_DAYS = 30;

function isAvailable(candidate: MatchCandidate, now: Date): boolean {
  if (!candidate.lastSeenAvailable) return false;
  const ageMs = now.getTime() - candidate.lastSeenAvailable.getTime();
  return ageMs <= AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

function buildTrustedReasons(
  trusted: TrustedPreference,
  candidate: MatchCandidate,
  hadRejections: boolean
): string[] {
  const reasons = [`Eerder ${trusted.timesChosen} keer gekozen.`];
  if (candidate.packageQuantity != null) reasons.push("Heeft de juiste verpakking.");
  reasons.push("Is momenteel beschikbaar.");
  if (hadRejections) reasons.push("Staat niet op de afwijslijst.");
  return reasons;
}

function buildSingleCandidateReasons(candidate: MatchCandidate, hadRejections: boolean): string[] {
  const reasons = ["Het enige bekende product voor dit ingrediënt.", "Is momenteel beschikbaar."];
  if (candidate.packageQuantity != null) reasons.push("Heeft een bekende verpakkingsgrootte.");
  if (hadRejections) reasons.push("Staat niet op de afwijslijst.");
  return reasons;
}

/**
 * Score voor een kandidaat zonder vertrouwde voorkeur en zonder dat het de
 * enige optie is — dit is het echte "twijfelgeval": meerdere beschikbare
 * producten, geen eerdere keuze om op te varen. De score bepaalt alleen de
 * volgorde van voorstellen, nooit automatische acceptatie (status blijft
 * MATCHED_REVIEW_REQUIRED).
 *
 * De redenen moeten per kandidaat verschillen (Fase 12: geen herhaalde
 * algemene redenen) — daarom vertelt dit expliciet hóe deze kandidaat zich
 * verhoudt tot de andere beschikbare opties (goedkoopst, of gewoon "beste
 * van N"), in plaats van alleen de huishoudinstelling te herhalen.
 */
function scoreCandidate(
  candidate: MatchCandidate,
  productChoicePreference: NonNullable<ProductMatchInput["productChoicePreference"]>,
  context: { totalAvailable: number; cheapestPrice: number | null }
): { score: number; reasons: string[] } {
  let score = 0.4;
  const reasons = ["Is momenteel beschikbaar."];
  if (candidate.packageQuantity != null) {
    score += 0.1;
    reasons.push("Heeft een bekende verpakkingsgrootte.");
  }

  if (productChoicePreference === "LOW_PRICE" && candidate.price != null) {
    score += Math.max(0, 0.18 - candidate.price * 0.02);
    if (context.cheapestPrice != null && candidate.price <= context.cheapestPrice) {
      reasons.push(`Goedkoopste van ${context.totalAvailable} beschikbare opties.`);
    }
  } else if (productChoicePreference === "KNOWN_PACKAGE" && candidate.packageQuantity != null) {
    score += 0.12;
    reasons.push("Heeft een duidelijke verpakkingsgrootte — dat is jullie voorkeur.");
  } else if (context.totalAvailable > 1) {
    reasons.push(`Beste van ${context.totalAvailable} beschikbare opties.`);
  }

  // Prijs blijft bij gebalanceerd een kleine tiebreak, geen dominante reden.
  if (productChoicePreference === "BALANCED" && candidate.price != null) score -= candidate.price * 0.0001;
  return { score: Math.min(0.7, score), reasons };
}

/**
 * De centrale, uitlegbare productmatch uit Fase 5 van het ontwerpdocument.
 * Nooit ondoorzichtige willekeur: elke uitkomst komt met een status,
 * confidence en concrete redenen.
 */
export function matchProduct(input: ProductMatchInput): ProductMatchResult {
  const now = input.now ?? new Date();
  const productChoicePreference = normalizeProductChoicePreference(input.productChoicePreference);
  const hadRejections = input.rejectedProductIds.size > 0;
  const candidates = input.candidates.filter((c) => !input.rejectedProductIds.has(c.id));

  if (candidates.length === 0) {
    return {
      status: "NOT_FOUND",
      productId: null,
      confidence: 0,
      reasons: ["Geen producten bekend voor dit ingrediënt."],
    };
  }

  const available = candidates.filter((c) => isAvailable(c, now));

  if (input.trusted) {
    const trustedCandidate = available.find((c) => c.id === input.trusted!.productId);
    if (trustedCandidate) {
      return {
        status: "MATCHED_TRUSTED",
        productId: trustedCandidate.id,
        confidence: Math.min(0.99, 0.6 + input.trusted.timesChosen * 0.1),
        reasons: buildTrustedReasons(input.trusted, trustedCandidate, hadRejections),
      };
    }
    const staleTrusted = candidates.find((c) => c.id === input.trusted!.productId);
    if (staleTrusted) {
      // Nog steeds een kandidaat (niet afgewezen), maar niet meer
      // beschikbaar bevonden — dat verdient aandacht, geen stille aanname.
      return {
        status: "UNAVAILABLE",
        productId: staleTrusted.id,
        confidence: 0.2,
        reasons: ["Eerder gekozen product lijkt niet meer beschikbaar — controleer of er een alternatief is."],
      };
    }
    // De vertrouwde keuze is afgewezen of niet langer een kandidaat: val
    // door naar de gewone afweging van de resterende kandidaten hieronder.
  }

  if (available.length === 0) {
    return {
      status: "UNAVAILABLE",
      productId: null,
      confidence: 0,
      reasons: ["Geen van de bekende producten is momenteel beschikbaar."],
    };
  }

  if (available.length === 1) {
    const only = available[0];
    return {
      status: "MATCHED_TRUSTED",
      productId: only.id,
      confidence: 0.8,
      reasons: buildSingleCandidateReasons(only, hadRejections),
    };
  }

  const availablePrices = available.map((c) => c.price).filter((p): p is number => p != null);
  const scoreContext = {
    totalAvailable: available.length,
    cheapestPrice: availablePrices.length > 0 ? Math.min(...availablePrices) : null,
  };
  const scored = available
    .map((candidate) => ({ candidate, ...scoreCandidate(candidate, productChoicePreference, scoreContext) }))
    .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id));
  const best = scored[0];

  return {
    status: "MATCHED_REVIEW_REQUIRED",
    productId: best.candidate.id,
    confidence: best.score,
    reasons: best.reasons,
  };
}
