import type { ProductProvider, Unit } from "@/generated/prisma/enums";
import { calculatePackageRequirement } from "@/lib/quantity/packages";
import { compareEquivalence, countsAsHardMatch, type EquivalenceCandidate, type EquivalenceLevel } from "./equivalence";

/**
 * Het mandje doorrekenen: wat kost deze boodschappenlijst bij winkel X?
 *
 * Dit is bewust geen prijsvergelijker maar een mandje-simulatie. De vraag is
 * niet "wat kost een pak melk" maar "wat kost 3 liter melk hier" — en dat
 * verschil is precies waar verpakkingsgroottes zichtbaar worden. Je koopt
 * verpakkingen, geen liters.
 *
 * Drie bedragen, nooit één (zie het equivalentiemodel):
 * - het **harde bedrag**: alleen hetzelfde of gelijkwaardig,
 * - het **alternatieve bedrag**: inclusief een andere klasse of soort,
 * - en het aantal regels dat helemaal niet te vergelijken viel.
 */

export interface BasketLineInput {
  lineId: string;
  ingredientId: string;
  ingredientName: string;
  /** Netto behoefte deze week, na aftrek van voorraad. */
  neededQuantity: number;
  unit: Unit;
  /** Het product dat we normaal kopen; `null` als er nog geen keuze is. */
  reference:
    | (EquivalenceCandidate & { price: number | null; packageQuantity: number | null })
    | null;
}

export interface StoreCandidateInput extends EquivalenceCandidate {
  provider: ProductProvider;
  productId: string;
  price: number;
  packageQuantity: number | null;
  promoLabel: string | null;
  observedAt: Date;
  stale: boolean;
}

export interface BasketLineStoreResult {
  provider: ProductProvider;
  productId: string;
  name: string;
  packageSize: string | null;
  /** Aantal verpakkingen dat je moet kopen om aan de behoefte te komen. */
  packagesToBuy: number | null;
  /** Wat dat kost. `null` als de verpakking onbekend is: dan valt er niets te rekenen. */
  cost: number | null;
  /** Hoeveel je overhoudt — 2 liter kopen voor 1,5 liter is geen besparing als de rest weg moet. */
  surplus: number | null;
  level: EquivalenceLevel;
  levelReason: string;
  promoLabel: string | null;
  observedAt: Date;
  stale: boolean;
  /** Waarom deze regel niet meetelt, als dat zo is. */
  missingReason: string | null;
}

export interface BasketLineResult {
  lineId: string;
  ingredientName: string;
  neededQuantity: number;
  unit: Unit;
  referencePrice: number | null;
  referenceName: string | null;
  /** Wat deze regel bij ons eigen product kost, met dezelfde verpakkingsberekening. */
  referenceCost: number | null;
  referencePackages: number | null;
  stores: Map<ProductProvider, BasketLineStoreResult>;
}

export interface BasketStoreTotal {
  provider: ProductProvider;
  /** Alleen identieke en gelijkwaardige producten. */
  hardTotal: number;
  /** Inclusief alternatieven uit een andere klasse of soort. */
  alternativeTotal: number;
  linesCompared: number;
  linesWithAlternative: number;
  /** Regels die deze winkel niet kon leveren of waarvan de match niet betrouwbaar was. */
  linesMissing: number;
  /**
   * Wat *dezelfde* regels bij ons eigen product kosten — dus alleen de regels
   * die in `hardTotal` zitten.
   *
   * Dit is het enige getal waar `hardTotal` eerlijk tegen afgezet mag worden.
   * Vergelijken met het totaal van de hele lijst zou betekenen dat een winkel
   * goedkoper lijkt naarmate ze mínder producten heeft — het klassieke
   * ongelijke-mandjes-probleem.
   */
  referenceTotalForHardLines: number;
  /** De oudste prijs die in dit totaal zit — de UI toont dat erbij. */
  oldestObservation: Date | null;
  anyStale: boolean;
}

export interface BasketComparison {
  lines: BasketLineResult[];
  /** Wat de lijst bij ons eigen (Picnic-)aanbod kost, voor zover bekend. */
  referenceTotal: number;
  referenceLinesMissing: number;
  totals: Map<ProductProvider, BasketStoreTotal>;
}

/**
 * Rekent één regel door bij één winkel.
 *
 * `null` als kosten betekent altijd iets concreets: geen bruikbare verpakking,
 * dus niets te rekenen. Nooit nul — een ontbrekende regel als €0 meetellen zou
 * die winkel goedkoper laten lijken dan hij is.
 */
function priceLineAtStore(
  line: BasketLineInput,
  candidate: StoreCandidateInput
): BasketLineStoreResult {
  const verdict = line.reference
    ? compareEquivalence(line.reference, candidate)
    : // Zonder eigen referentieproduct valt er niets te vergelijken: we weten
      // niet wat we normaal zouden kopen, dus ook niet of dit gelijkwaardig is.
      { level: "NIET_VERGELIJKBAAR" as const, reason: "we hebben zelf nog geen product gekozen" };

  const requirement = calculatePackageRequirement({
    recipeNeed: { amount: line.neededQuantity, unit: line.unit },
    packageSize:
      candidate.packageQuantity != null ? { amount: candidate.packageQuantity, unit: line.unit } : null,
  });

  // PACKAGE_UNKNOWN betekent: we weten niet hoeveel er in een verpakking zit,
  // dus er valt niets te rekenen. Dat is iets anders dan nul kosten.
  const packagesToBuy = requirement.status === "PACKAGE_UNKNOWN" ? null : requirement.packagesToBuy;
  const cost = packagesToBuy === null ? null : Number((packagesToBuy * candidate.price).toFixed(2));

  return {
    provider: candidate.provider,
    productId: candidate.productId,
    name: candidate.name,
    packageSize: candidate.packageSize,
    packagesToBuy,
    cost,
    surplus: requirement.expectedSurplus?.amount ?? null,
    level: verdict.level,
    levelReason: verdict.reason,
    promoLabel: candidate.promoLabel,
    observedAt: candidate.observedAt,
    stale: candidate.stale,
    missingReason:
      packagesToBuy === null
        ? "verpakkingsgrootte onbekend"
        : verdict.level === "NIET_VERGELIJKBAAR"
          ? verdict.reason
          : null,
  };
}

/**
 * Rekent de hele lijst door voor alle winkels.
 *
 * Een winkel die een regel niet heeft, krijgt daar niets voor in rekening
 * gebracht — maar de regel wordt wél geteld als ontbrekend. Dat onderscheid is
 * de kern: zonder dat lijkt de winkel met het kleinste assortiment de
 * goedkoopste.
 */
export function compareBasket(
  lines: BasketLineInput[],
  candidatesByLine: Map<string, StoreCandidateInput[]>,
  providers: ProductProvider[]
): BasketComparison {
  const results: BasketLineResult[] = [];
  const totals = new Map<ProductProvider, BasketStoreTotal>(
    providers.map((provider) => [
      provider,
      {
        provider,
        hardTotal: 0,
        alternativeTotal: 0,
        linesCompared: 0,
        linesWithAlternative: 0,
        linesMissing: 0,
        referenceTotalForHardLines: 0,
        oldestObservation: null,
        anyStale: false,
      },
    ])
  );

  let referenceTotal = 0;
  let referenceLinesMissing = 0;

  for (const line of lines) {
    const candidates = candidatesByLine.get(line.lineId) ?? [];
    const stores = new Map<ProductProvider, BasketLineStoreResult>();

    // Wat het bij ons eigen aanbod kost — dezelfde verpakkingsberekening, zodat
    // de kolommen echt vergelijkbaar zijn en niet appels met peren.
    let referenceCost: number | null = null;
    let referencePackages: number | null = null;
    if (line.reference?.price != null && line.reference.packageQuantity != null) {
      const requirement = calculatePackageRequirement({
        recipeNeed: { amount: line.neededQuantity, unit: line.unit },
        packageSize: { amount: line.reference.packageQuantity, unit: line.unit },
      });
      if (requirement.status === "PACKAGE_UNKNOWN") {
        referenceLinesMissing += 1;
      } else {
        referencePackages = requirement.packagesToBuy;
        referenceCost = Number((requirement.packagesToBuy * line.reference.price).toFixed(2));
        referenceTotal += requirement.packagesToBuy * line.reference.price;
      }
    } else {
      referenceLinesMissing += 1;
    }

    for (const provider of providers) {
      const forProvider = candidates.filter((candidate) => candidate.provider === provider);
      const total = totals.get(provider)!;

      if (forProvider.length === 0) {
        total.linesMissing += 1;
        continue;
      }

      // Van de kandidaten bij deze winkel de best vergelijkbare kiezen:
      // liever een gelijkwaardig product dan een goedkoper alternatief, want
      // "goedkoper door iets anders te kopen" is geen besparing.
      const priced = forProvider
        .map((candidate) => priceLineAtStore(line, candidate))
        .filter((result) => result.cost !== null);

      if (priced.length === 0) {
        total.linesMissing += 1;
        // Toch tonen: de gebruiker moet zien dát er iets gevonden is en
        // waarom het niet meetelt.
        const first = priceLineAtStore(line, forProvider[0]);
        stores.set(provider, first);
        continue;
      }

      const best =
        priced.find((result) => result.level === "IDENTIEK") ??
        priced.find((result) => result.level === "GELIJKWAARDIG") ??
        priced.find((result) => result.level === "ALTERNATIEF") ??
        priced[0];

      stores.set(provider, best);

      if (best.level === "NIET_VERGELIJKBAAR") {
        total.linesMissing += 1;
      } else if (referenceCost === null) {
        // De winkel heeft een passend product, maar onze eigen prijs kennen we
        // niet. Dan kan deze regel in géén van beide totalen: hem alleen bij de
        // winkel optellen zou die winkel duurder laten lijken dan hij is,
        // precies zoals andersom het omgekeerde zou gebeuren. De prijs blijft
        // wel gewoon op de regel staan.
        best.missingReason = "onze eigen prijs is onbekend";
        total.linesMissing += 1;
      } else if (countsAsHardMatch(best.level)) {
        total.hardTotal += best.cost!;
        total.alternativeTotal += best.cost!;
        total.linesCompared += 1;
        // Alleen wat aan beide kanten meetelt mag naast elkaar staan.
        total.referenceTotalForHardLines += referenceCost;
      } else {
        // Een alternatief telt alleen in het tweede bedrag. In het harde
        // bedrag komt het product dat we normaal kopen niet voor — dus daar
        // telt deze regel als ontbrekend.
        total.alternativeTotal += best.cost!;
        total.linesWithAlternative += 1;
        total.linesMissing += 1;
      }

      if (!total.oldestObservation || best.observedAt < total.oldestObservation) {
        total.oldestObservation = best.observedAt;
      }
      if (best.stale) total.anyStale = true;
    }

    results.push({
      lineId: line.lineId,
      ingredientName: line.ingredientName,
      neededQuantity: line.neededQuantity,
      unit: line.unit,
      referencePrice: line.reference?.price ?? null,
      referenceName: line.reference?.name ?? null,
      referenceCost,
      referencePackages,
      stores,
    });
  }

  for (const total of totals.values()) {
    total.hardTotal = Number(total.hardTotal.toFixed(2));
    total.alternativeTotal = Number(total.alternativeTotal.toFixed(2));
    total.referenceTotalForHardLines = Number(total.referenceTotalForHardLines.toFixed(2));
  }

  return {
    lines: results,
    referenceTotal: Number(referenceTotal.toFixed(2)),
    referenceLinesMissing,
    totals,
  };
}
