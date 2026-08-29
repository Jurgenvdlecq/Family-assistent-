import type { ProductProvider, Unit } from "@/generated/prisma/enums";
import { calculatePackageRequirement } from "@/lib/quantity/packages";
import { compareEquivalence, countsAsHardMatch, type EquivalenceCandidate, type EquivalenceLevel } from "./equivalence";
import { applyPromotion, parsePromoMechanism, promotionIsActive } from "./promotions";

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
  /**
   * Bij vaste en handmatige regels in stuks is `neededQuantity` geen
   * hoeveelheid maar een door de gebruiker gekozen **aantal verpakkingen**
   * ("2x brood"). Zie `isUserChosenPackageCount`. Dan is er niets uit te
   * rekenen: je koopt er precies zoveel, bij elke winkel.
   */
  quantityIsPackageCount?: boolean;
  /** Het product dat we normaal kopen; `null` als er nog geen keuze is. */
  reference:
    | (EquivalenceCandidate & {
        price: number | null;
        packageQuantity: number | null;
        packageUnit: Unit | null;
        /** Prijs per liter/kilo/stuk, zodat verpakkingsgroottes vergelijkbaar zijn. */
        unitPrice?: number | null;
        unitPriceUnit?: Unit | null;
      })
    | null;
}

export interface StoreCandidateInput extends EquivalenceCandidate {
  provider: ProductProvider;
  productId: string;
  price: number;
  packageQuantity: number | null;
  /**
   * De eenheid waarin `packageQuantity` staat (die van het ingrediënt). Wijkt
   * die af van de eenheid van de regel, dan valt er niets te rekenen — dan
   * zou "2 stuks" tegen "1000 ml per verpakking" worden afgezet.
   */
  packageUnit: Unit | null;
  promoLabel: string | null;
  /** Tot wanneer de actie loopt; `null` als de winkel dat niet meegeeft. */
  promoUntil: Date | null;
  /** De van-prijs bij een actie. */
  wasPrice: number | null;
  /**
   * Of die van-prijs volgens de prijsgeschiedenis nooit echt gerekend is.
   * Wordt buiten dit domein bepaald (daar zit de geschiedenis), maar hoort
   * wél op de regel: een korting die geen korting is, mag niet als voordeel
   * op het scherm komen.
   */
  fakeDiscount?: boolean;
  /**
   * De productpagina bij de winkel zelf. Bedoeld om na te kunnen kijken of dit
   * écht hetzelfde product is — de app zegt "gelijkwaardig", de winkelpagina
   * bewijst het. `null` waar we de link niet betrouwbaar kennen; dan liever
   * geen link dan een gokje dat op een 404 uitkomt.
   */
  productUrl?: string | null;
  /** Prijs per liter/kilo/stuk, zoals de winkel of de verpakking hem geeft. */
  unitPrice?: number | null;
  unitPriceUnit?: Unit | null;
  observedAt: Date;
  stale: boolean;
}

export interface BasketLineStoreResult {
  provider: ProductProvider;
  productId: string;
  name: string;
  /** Het merk, voor zover de winkel dat apart meegeeft. */
  brand: string | null;
  packageSize: string | null;
  /** De productpagina bij de winkel, om zelf na te kijken of het hetzelfde is. */
  productUrl: string | null;
  /** Prijs per liter/kilo/stuk — het enige getal dat over verpakkingen heen vergelijkt. */
  unitPrice: number | null;
  unitPriceUnit: Unit | null;
  /** Wat er in één verpakking zit, in de eenheid van het ingrediënt. */
  packageQuantity: number | null;
  /** Aantal verpakkingen dat je moet kopen om aan de behoefte te komen. */
  packagesToBuy: number | null;
  /** Wat dat kost. `null` als de verpakking onbekend is: dan valt er niets te rekenen. */
  cost: number | null;
  /** Hoeveel je overhoudt — 2 liter kopen voor 1,5 liter is geen besparing als de rest weg moet. */
  surplus: number | null;
  level: EquivalenceLevel;
  levelReason: string;
  promoLabel: string | null;
  /** Tot wanneer de actie loopt; `null` als de winkel dat niet meegeeft. */
  promoUntil: Date | null;
  /** De van-prijs bij een actie, per verpakking. */
  wasPrice: number | null;
  /**
   * Levert deze actie bij dít aantal verpakkingen ook echt voordeel op?
   *
   * Alleen dán mag er een actie-markering op het overzicht komen. Het label
   * zelf blijft wél staan in het uitklapblok, mét de uitleg erbij ("je krijgt
   * pas voordeel vanaf 2 stuks") — dat is informatie. Een groene "Actie" bij
   * één pak melk is dat niet; dan is het een reclamebalk. Dezelfde grens die
   * `collectPromoHighlights` al hanteerde, nu ook voor de markering.
   */
  promotionCounts: boolean;
  /** Wat de actie hier concreet doet: "3 halen, 2 betalen". */
  promoExplanation: string | null;
  /** Wat het zonder de actie gekost zou hebben; gelijk aan `cost` als er geen actie is. */
  costWithoutPromo: number | null;
  /** De van-prijs klopt niet met de prijsgeschiedenis. */
  fakeDiscount: boolean;
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
  /** Merk en verpakking van ons eigen product, zodat de drie kolommen dezelfde velden tonen. */
  referenceBrand: string | null;
  referencePackageSize: string | null;
  referenceUnitPrice: number | null;
  referenceUnitPriceUnit: Unit | null;
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
  /**
   * Hetzelfde, maar voor `alternativeTotal` — dus inclusief de regels waar een
   * ander soort product is voorgesteld.
   *
   * Bestaat om precies dezelfde reden: zonder eigen bedrag over dezelfde
   * regels zou het alternatieve bedrag naast het *harde* referentiebedrag
   * komen te staan, dat over minder regels gaat. Dan lijkt "ook alternatieven
   * meerekenen" duurder of goedkoper dan het is.
   */
  referenceTotalForAlternativeLines: number;
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

/** De eenheid zoals een mens hem leest, voor de uitleg op het scherm. */
const UNIT_WORDS: Record<Unit, string> = { GRAM: "gram", ML: "ml", PIECE: "stuks" };

/**
 * Hoeveel verpakkingen zijn er nodig, en houden we iets over?
 *
 * Eén plek voor beide kanten van de vergelijking (onze eigen prijs én die van
 * de winkel), want zodra die twee anders rekenen zijn de bedragen niet meer
 * naast elkaar te zetten.
 *
 * `packagesToBuy: null` betekent altijd iets concreets: er valt niets te
 * rekenen. Nooit nul — een onbekende verpakking als €0 meetellen zou die
 * winkel goedkoper laten lijken dan hij is.
 */
function packagesForLine(
  line: BasketLineInput,
  packageQuantity: number | null,
  packageUnit: Unit | null,
  isReference: boolean
): { packagesToBuy: number | null; surplus: number | null; reason: string | null } {
  // "3x Alpro" is geen hoeveelheid maar een aantal verpakkingen — en wel ónze
  // verpakkingen. Dat is precies waar het misging: drie keer een vierpak van
  // een andere winkel is twaalf stuks en € 32,94, terwijl je er drie wilde.
  if (line.quantityIsPackageCount) {
    const count = Math.ceil(line.neededQuantity);

    // Aan onze eigen kant is het aantal per definitie het aantal.
    if (isReference) return { packagesToBuy: count, surplus: null, reason: null };

    // Eén stuk nodig: dan koop je er bij elke winkel één, ook als daar meer in
    // zit. De verpakkingsgrootte staat ernaast, dus het verschil is zichtbaar.
    if (count === 1) return { packagesToBuy: 1, surplus: null, reason: null };

    // Meer dan één: dan moet het aantal eerst door onze eigen verpakking heen
    // naar een echte hoeveelheid, en pas daarna door die van de winkel.
    const ownContent = line.reference?.packageQuantity ?? null;
    const ownUnit = line.reference?.packageUnit ?? null;
    if (ownUnit !== null && packageUnit !== null && ownUnit !== packageUnit) {
      // Twee verpakkingen die niet in dezelfde eenheid staan: "4 stuks"
      // tegenover "750 gram". Doorrekenen levert dan een bedrag op dat nergens
      // op slaat — in productie werden drie pakken Alpro zo 563 verpakkingen
      // van € 10,98. Wat de winkel wél verkoopt staat gewoon op het scherm,
      // met deze reden erbij.
      return {
        packagesToBuy: null,
        surplus: null,
        reason: `verpakking in ${UNIT_WORDS[packageUnit]}, die van ons in ${UNIT_WORDS[ownUnit]}`,
      };
    }
    if (ownContent == null || packageQuantity == null) {
      // Zonder onze eigen verpakkingsinhoud valt "drie keer die van ons" niet
      // om te rekenen naar die van de winkel. Dan liever niets zeggen dan een
      // bedrag dat er twaalf koopt.
      return { packagesToBuy: null, surplus: null, reason: "verpakkingen niet te vergelijken" };
    }

    const needed = count * ownContent;
    const packages = Math.ceil(Math.round((needed / packageQuantity) * 1e6) / 1e6);
    return {
      packagesToBuy: packages,
      surplus: Number((packages * packageQuantity - needed).toFixed(2)),
      reason: null,
    };
  }

  if (packageQuantity == null) {
    return { packagesToBuy: null, surplus: null, reason: "verpakkingsgrootte onbekend" };
  }

  // De verpakkingsinhoud staat in de eenheid van het ingrediënt; de regel kan
  // een andere eenheid hebben. Doorrekenen zou dan "2 stuks" tegen "1000 ml
  // per verpakking" afzetten en een bedrag opleveren dat nergens op slaat.
  if (packageUnit !== null && packageUnit !== line.unit) {
    return {
      packagesToBuy: null,
      surplus: null,
      reason: `verpakking in ${UNIT_WORDS[packageUnit]}, nodig in ${UNIT_WORDS[line.unit]}`,
    };
  }

  const requirement = calculatePackageRequirement({
    recipeNeed: { amount: line.neededQuantity, unit: line.unit },
    packageSize: { amount: packageQuantity, unit: line.unit },
  });
  if (requirement.status === "PACKAGE_UNKNOWN") {
    return { packagesToBuy: null, surplus: null, reason: "verpakkingsgrootte onbekend" };
  }
  return {
    packagesToBuy: requirement.packagesToBuy,
    surplus: requirement.expectedSurplus?.amount ?? null,
    reason: null,
  };
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
  candidate: StoreCandidateInput,
  now: Date
): BasketLineStoreResult {
  const verdict = line.reference
    ? compareEquivalence(line.reference, candidate)
    : // Zonder eigen referentieproduct valt er niets te vergelijken: we weten
      // niet wat we normaal zouden kopen, dus ook niet of dit gelijkwaardig is.
      { level: "NIET_VERGELIJKBAAR" as const, reason: "we hebben zelf nog geen product gekozen" };

  const packaging = packagesForLine(line, candidate.packageQuantity, candidate.packageUnit, false);
  const packagesToBuy = packaging.packagesToBuy;

  // Een kortingslabel is geen prijs. "1+1 gratis" bij drie stuks is 33%
  // korting, niet 50%, en bij één stuk helemaal geen. Alleen een mechanisme
  // dat we zeker herkennen én dat nog loopt wordt toegepast; de rest laat de
  // gewone prijs staan.
  const active = promotionIsActive(candidate.promoUntil, now);
  const mechanism = active ? parsePromoMechanism(candidate.promoLabel) : null;
  const outcome =
    packagesToBuy === null ? null : applyPromotion(packagesToBuy, candidate.price, mechanism);
  const cost = outcome?.cost ?? null;

  // Twee soorten actie leveren op verschillende manieren voordeel op. Bij een
  // mechanische actie ("1+1 gratis") zit het in het aantal: bij één pak is er
  // niets gratis, en dan is er ook niets te melden. Bij een gewone bonusprijs
  // zit de korting al in `price`, dus daar is de van-prijs het bewijs. Alleen
  // met een van die twee mag er een markering komen.
  const mechanicalSaving =
    outcome === null ? 0 : Number((outcome.costWithoutPromo - outcome.cost).toFixed(2));
  const lowerThanBefore = candidate.wasPrice !== null && candidate.wasPrice > candidate.price;
  const promotionCounts =
    active &&
    candidate.promoLabel !== null &&
    candidate.fakeDiscount !== true &&
    (mechanicalSaving >= 0.01 || lowerThanBefore);

  return {
    provider: candidate.provider,
    productId: candidate.productId,
    name: candidate.name,
    brand: candidate.brand,
    packageSize: candidate.packageSize,
    productUrl: candidate.productUrl ?? null,
    unitPrice: candidate.unitPrice ?? null,
    unitPriceUnit: candidate.unitPriceUnit ?? null,
    packageQuantity: candidate.packageQuantity,
    packagesToBuy,
    cost,
    surplus: packaging.surplus,
    level: verdict.level,
    levelReason: verdict.reason,
    // Een verlopen actie is geen actie meer. Zolang het label alleen in het
    // uitklapblok stond was dat hooguit rommelig; nu het als "Actie" in het
    // overzicht komt, zou het een aanbieding beloven die er niet is.
    // `promoUntil: null` betekent "de winkel zegt er niets over" en telt dus
    // gewoon als lopend — dat is geen bewijs van het tegendeel.
    promoLabel: active ? candidate.promoLabel : null,
    promoUntil: candidate.promoUntil,
    promotionCounts,
    wasPrice: candidate.wasPrice,
    promoExplanation: outcome?.explanation ?? null,
    costWithoutPromo: outcome?.costWithoutPromo ?? null,
    // Een van-prijs die volgens de geschiedenis nooit gerekend is, mag niet
    // als voordeel op het scherm komen.
    fakeDiscount: candidate.fakeDiscount === true,
    observedAt: candidate.observedAt,
    stale: candidate.stale,
    missingReason:
      packagesToBuy === null
        ? packaging.reason ?? "verpakkingsgrootte onbekend"
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
  providers: ProductProvider[],
  now: Date = new Date()
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
        referenceTotalForAlternativeLines: 0,
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
    if (line.reference?.price != null) {
      const packaging = packagesForLine(
        line,
        line.reference.packageQuantity,
        line.reference.packageUnit,
        true
      );
      if (packaging.packagesToBuy === null) {
        referenceLinesMissing += 1;
      } else {
        referencePackages = packaging.packagesToBuy;
        referenceCost = Number((packaging.packagesToBuy * line.reference.price).toFixed(2));
        referenceTotal += packaging.packagesToBuy * line.reference.price;
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
        .map((candidate) => priceLineAtStore(line, candidate, now))
        .filter((result) => result.cost !== null);

      if (priced.length === 0) {
        total.linesMissing += 1;
        // Toch tonen: de gebruiker moet zien dát er iets gevonden is en
        // waarom het niet meetelt.
        const first = priceLineAtStore(line, forProvider[0], now);
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
        total.referenceTotalForAlternativeLines += referenceCost;
      } else {
        // Een alternatief telt alleen in het tweede bedrag. In het harde
        // bedrag komt het product dat we normaal kopen niet voor — dus daar
        // telt deze regel als ontbrekend.
        total.alternativeTotal += best.cost!;
        total.referenceTotalForAlternativeLines += referenceCost;
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
      referenceBrand: line.reference?.brand ?? null,
      referencePackageSize: line.reference?.packageSize ?? null,
      referenceUnitPrice: line.reference?.unitPrice ?? null,
      referenceUnitPriceUnit: line.reference?.unitPriceUnit ?? null,
      referenceCost,
      referencePackages,
      stores,
    });
  }

  for (const total of totals.values()) {
    total.hardTotal = Number(total.hardTotal.toFixed(2));
    total.alternativeTotal = Number(total.alternativeTotal.toFixed(2));
    total.referenceTotalForHardLines = Number(total.referenceTotalForHardLines.toFixed(2));
    total.referenceTotalForAlternativeLines = Number(total.referenceTotalForAlternativeLines.toFixed(2));
  }

  return {
    lines: results,
    referenceTotal: Number(referenceTotal.toFixed(2)),
    referenceLinesMissing,
    totals,
  };
}
