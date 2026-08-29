/**
 * Koop je één verpakking, of een setje losse porties?
 *
 * Aanleiding is een melding uit de praktijk: bij appelmoes stond onze pot van
 * 720 gram naast een doosje van vier cupjes van 100 gram. Als hoeveelheid
 * klopt dat allebei, en de mandje-simulatie rekent er vrolijk mee — maar het
 * is niet hetzelfde product. Cupjes zijn een broodtrommelverpakking met een
 * eigen prijs per kilo; een pot is een pot.
 *
 * Bewust maar twee vormen en een `null`. Dit is geen poging om
 * verpakkingssoorten te classificeren, alleen om het ene verschil te
 * herkennen dat de vergelijking scheeftrekt. Wat niet ondubbelzinnig te lezen
 * is blijft onbekend, en onbekend leidt nooit tot een oordeel.
 */
export type PackageForm = "LOSSE_PORTIES" | "EEN_VERPAKKING";

/** Woorden waarmee winkels een portieverpakking aanduiden. */
const PORTION_WORDS = [
  "cup",
  "cups",
  "cupje",
  "cupjes",
  "knijpzak",
  "knijpzakje",
  "knijpfruit",
  "portie",
  "porties",
  "portieverpakking",
  "minibeker",
  "beker",
  "bekers",
];

/**
 * Een aantal maal een inhoud: "4 x 100 g", "6x330ml". Dat is de betrouwbaarste
 * aanwijzing dat het om losse eenheden gaat, want die notatie gebruiken alle
 * winkels.
 */
const MULTIPACK = /\b\d+\s*[x×]\s*\d/;

export function derivePackageForm(
  packageSize: string | null | undefined,
  name?: string | null
): PackageForm | null {
  const pack = (packageSize ?? "").toLowerCase();
  const text = `${pack} ${(name ?? "").toLowerCase()}`;

  if (MULTIPACK.test(pack)) return "LOSSE_PORTIES";
  if (PORTION_WORDS.some((word) => new RegExp(`\\b${word}\\b`).test(text))) return "LOSSE_PORTIES";

  // Eén getal met een eenheid en verder niets: één verpakking. Staat er niets
  // leesbaars, dan weten we het niet — en dan zeggen we het ook niet.
  if (/^\s*(?:ca\.?\s*)?\d+(?:[.,]\d+)?\s*(?:g|gram|kg|ml|cl|l|liter|stuks?|st\.?)\b/.test(pack)) {
    return "EEN_VERPAKKING";
  }
  return null;
}

/** Waarom deze twee niet hetzelfde zijn, in gewone taal. */
export function describeFormShift(candidate: PackageForm): string {
  return candidate === "LOSSE_PORTIES"
    ? "losse porties in plaats van één verpakking"
    : "één verpakking in plaats van losse porties";
}
