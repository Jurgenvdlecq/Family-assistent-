import type { QualityTier } from "@/generated/prisma/enums";
import { comparablePreservation, derivePreservation, sameQualityTier } from "./qualityTier";

/**
 * Hoe zeker weten we dat dit hetzelfde product is?
 *
 * De reden dat dit vier niveaus zijn en geen ja/nee: een matcher die per
 * product het goedkoopste alternatief pakt, liegt. Het voorbeeld uit de
 * opdracht is echt — verse melk stilletjes vervangen door houdbare melk is
 * 34% "besparing" die niemand gevraagd heeft. Door de niveaus apart op te
 * tellen kan het scherm drie eerlijke getallen tonen in plaats van één
 * misleidend getal.
 */
export const EQUIVALENCE_LEVELS = ["IDENTIEK", "GELIJKWAARDIG", "ALTERNATIEF", "NIET_VERGELIJKBAAR"] as const;

export type EquivalenceLevel = (typeof EQUIVALENCE_LEVELS)[number];

export const EQUIVALENCE_LABELS: Record<EquivalenceLevel, string> = {
  IDENTIEK: "hetzelfde product",
  GELIJKWAARDIG: "gelijkwaardig",
  ALTERNATIEF: "ander soort",
  NIET_VERGELIJKBAAR: "niet te vergelijken",
};

export interface EquivalenceCandidate {
  name: string;
  brand: string | null;
  packageSize: string | null;
  qualityTier: QualityTier | null;
  gtin: string | null;
  labels?: string[];
}

export interface EquivalenceVerdict {
  level: EquivalenceLevel;
  /** In gewone taal waaróm — dit komt op de regel zelf te staan. */
  reason: string;
}

function normalizedBrand(value: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function normalizedPack(value: string | null): string | null {
  const trimmed = value?.trim().toLowerCase().replace(/\s+/g, " ");
  return trimmed ? trimmed : null;
}

/**
 * Vergelijkt een winkelproduct met het product dat we normaal kopen.
 *
 * De volgorde is van hard naar zacht, en elke stap eist méér dan de vorige
 * mag aannemen:
 *
 * 1. **Zelfde barcode** — dan is het letterlijk hetzelfde product. Alleen
 *    mogelijk als beide kanten een barcode hebben; ontbreekt er één, dan is
 *    dat geen bewijs van verschil maar ook geen bewijs van gelijkheid.
 * 2. **Zelfde merk én verpakking** — praktisch hetzelfde product.
 * 3. **Zelfde klasse en dezelfde vers/houdbaar-soort** — een gelijkwaardige
 *    keuze, ook al is het een ander merk.
 * 4. **Andere klasse of andere soort** — een alternatief. Mag voorgesteld
 *    worden, maar telt in een apart bedrag.
 * 5. **Klasse onbekend** — niet vergelijkbaar. Nadrukkelijk niet
 *    "waarschijnlijk wel goed": dat is precies de aanname die de vergelijking
 *    onbetrouwbaar maakt.
 */
export function compareEquivalence(
  reference: EquivalenceCandidate,
  candidate: EquivalenceCandidate
): EquivalenceVerdict {
  if (reference.gtin && candidate.gtin && reference.gtin === candidate.gtin) {
    return { level: "IDENTIEK", reason: "zelfde barcode" };
  }

  // De vers/houdbaar-controle staat bewust vóór de merk-en-verpakking-regel.
  // Anders zou "AH Verse halfvolle melk 1 l" en "AH Houdbare halfvolle melk
  // 1 l" als identiek gelden: zelfde merk, zelfde verpakking — en precies het
  // paar waar de opdracht mee opent. Alleen een gelijke barcode is sterker,
  // want dan is het letterlijk hetzelfde artikel.
  const referencePreservation = derivePreservation(reference.name, reference.labels ?? []);
  const candidatePreservation = derivePreservation(candidate.name, candidate.labels ?? []);
  if (!comparablePreservation(referencePreservation, candidatePreservation)) {
    return {
      level: "ALTERNATIEF",
      reason: describePreservationShift(referencePreservation, candidatePreservation),
    };
  }

  const referenceBrand = normalizedBrand(reference.brand);
  const candidateBrand = normalizedBrand(candidate.brand);
  const referencePack = normalizedPack(reference.packageSize);
  const candidatePack = normalizedPack(candidate.packageSize);

  if (
    referenceBrand &&
    candidateBrand &&
    referenceBrand === candidateBrand &&
    referencePack &&
    candidatePack &&
    referencePack === candidatePack
  ) {
    return { level: "IDENTIEK", reason: "zelfde merk en verpakking" };
  }

  if (reference.qualityTier === null || candidate.qualityTier === null) {
    return { level: "NIET_VERGELIJKBAAR", reason: "soort product niet vast te stellen" };
  }

  if (sameQualityTier(reference.qualityTier, candidate.qualityTier)) {
    return { level: "GELIJKWAARDIG", reason: "zelfde soort product" };
  }

  return {
    level: "ALTERNATIEF",
    reason: `${describeTierShift(reference.qualityTier, candidate.qualityTier)}`,
  };
}

/**
 * De uitleg beschrijft altijd wat je in plaats daarvan zou kopen. Eén kant
 * kan onbekend zijn — dan is "een andere soort" het eerlijkste dat de app kan
 * zeggen, want een onbekende soort is geen bewijs van het tegendeel.
 */
function describePreservationShift(
  reference: "VERS" | "HOUDBAAR" | null,
  candidate: "VERS" | "HOUDBAAR" | null
): string {
  if (candidate === "HOUDBAAR") return "houdbaar in plaats van vers";
  if (candidate === "VERS") return "vers in plaats van houdbaar";
  return reference === "VERS" ? "onduidelijk of dit ook vers is" : "onduidelijk of dit ook houdbaar is";
}

function describeTierShift(from: QualityTier, to: QualityTier): string {
  if (to === "BUDGET") return "voordeelmerk in plaats van wat jullie normaal kopen";
  if (from === "BIO" && to !== "BIO") return "niet-biologisch";
  if (to === "BIO") return "biologisch in plaats van gewoon";
  if (to === "PREMIUM") return "duurdere lijn";
  return "ander soort product";
}

/** Telt dit niveau mee in het harde bedrag? */
export function countsAsHardMatch(level: EquivalenceLevel): boolean {
  return level === "IDENTIEK" || level === "GELIJKWAARDIG";
}
