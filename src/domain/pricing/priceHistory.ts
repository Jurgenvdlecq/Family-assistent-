/**
 * Wat het prijsverloop ons vertelt.
 *
 * Prijs is in dit model een waarneming in de tijd en geen eigenschap van een
 * product (zie `PriceObservation`). Dat betaalt zich hier uit: pas met een
 * reeks waarnemingen kun je zeggen of € 1,29 een gewone prijs is of een
 * uitschieter, en of een "van-prijs" ooit echt gerekend werd.
 *
 * Alles hier is bewust terughoudend. Bij te weinig waarnemingen is het
 * antwoord "dat weet ik nog niet" — niet een conclusie op basis van twee
 * metingen.
 */

export interface PriceSample {
  price: number;
  wasPrice: number | null;
  observedAt: Date;
}

/** Onder dit aantal waarnemingen zeggen we niets over "normaal". */
export const MIN_SAMPLES_FOR_TREND = 4;

export interface PriceHistorySummary {
  /** De meest voorkomende prijs; `null` bij te weinig waarnemingen. */
  typicalPrice: number | null;
  lowestPrice: number | null;
  highestPrice: number | null;
  samples: number;
  /** De periode waar dit over gaat. */
  from: Date | null;
  to: Date | null;
}

/**
 * De gewone prijs is de mediaan, niet het gemiddelde.
 *
 * Een gemiddelde wordt meegetrokken door een enkele actieweek; de mediaan
 * zegt eerlijker wat je normaal betaalt.
 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(2))
    : sorted[middle];
}

export function summarizePriceHistory(samples: PriceSample[]): PriceHistorySummary {
  if (samples.length === 0) {
    return { typicalPrice: null, lowestPrice: null, highestPrice: null, samples: 0, from: null, to: null };
  }

  const prices = samples.map((sample) => sample.price);
  const times = samples.map((sample) => sample.observedAt.getTime());
  return {
    typicalPrice: samples.length >= MIN_SAMPLES_FOR_TREND ? median(prices) : null,
    lowestPrice: Math.min(...prices),
    highestPrice: Math.max(...prices),
    samples: samples.length,
    from: new Date(Math.min(...times)),
    to: new Date(Math.max(...times)),
  };
}

export type DiscountVerdict =
  | { kind: "ECHTE_KORTING"; savedPerPackage: number; reason: string }
  | { kind: "NEPKORTING"; reason: string }
  | { kind: "ONBEKEND"; reason: string };

/** Hoe ver terug we kijken om te beoordelen of een van-prijs echt bestond. */
export const FAKE_DISCOUNT_WINDOW_DAYS = 60;

/**
 * Was die van-prijs er ook echt?
 *
 * Het patroon dat dit vangt: een winkel zet de prijs een week hoog en noemt de
 * gewone prijs daarna een "actie". Met een reeks waarnemingen is dat zichtbaar
 * — de van-prijs is dan een bedrag dat in de afgelopen twee maanden nooit
 * gerekend is.
 *
 * Drie mogelijke antwoorden, en "onbekend" is er nadrukkelijk één van. Zonder
 * geschiedenis kunnen we niets zeggen, en dan zegt de app ook niets in plaats
 * van de winkel op zijn woord te geloven óf ten onrechte van bedrog te
 * betichten.
 */
export function judgeDiscount(
  current: PriceSample,
  history: PriceSample[],
  now: Date = new Date()
): DiscountVerdict {
  if (current.wasPrice === null || current.wasPrice <= current.price) {
    return { kind: "ONBEKEND", reason: "geen actie" };
  }

  const cutoff = now.getTime() - FAKE_DISCOUNT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const earlier = history.filter(
    (sample) => sample.observedAt.getTime() >= cutoff && sample.observedAt < current.observedAt
  );

  if (earlier.length < MIN_SAMPLES_FOR_TREND) {
    return { kind: "ONBEKEND", reason: "te weinig prijsgeschiedenis om dit te beoordelen" };
  }

  // Is de van-prijs ooit echt gerekend? Een cent speling, want winkels
  // schrijven bedragen soms net anders op.
  const wasEverCharged = earlier.some((sample) => Math.abs(sample.price - current.wasPrice!) <= 0.01);
  if (wasEverCharged) {
    return {
      kind: "ECHTE_KORTING",
      savedPerPackage: Number((current.wasPrice - current.price).toFixed(2)),
      reason: "die van-prijs is hier eerder ook echt gerekend",
    };
  }

  // De van-prijs bestond niet, maar is de huidige prijs dan wél laag? Als de
  // prijs gewoon is wat hij altijd was, is er niets bespaard.
  const typical = median(earlier.map((sample) => sample.price));
  if (current.price >= typical - 0.01) {
    return {
      kind: "NEPKORTING",
      reason: `dit is gewoon de normale prijs (meestal € ${typical.toFixed(2).replace(".", ",")})`,
    };
  }

  return {
    kind: "ECHTE_KORTING",
    savedPerPackage: Number((typical - current.price).toFixed(2)),
    reason: `goedkoper dan de gebruikelijke € ${typical.toFixed(2).replace(".", ",")}`,
  };
}
