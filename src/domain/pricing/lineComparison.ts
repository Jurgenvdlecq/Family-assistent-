import type { ProductProvider, Unit } from "@/generated/prisma/enums";
import { countsAsHardMatch, EQUIVALENCE_LABELS, type EquivalenceLevel } from "./equivalence";
import type { BasketLineResult } from "./basketComparison";
import { formatUnitPrice } from "./unitPrice";

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
  /**
   * Wat één verpakking kost, ook als de regel zelf niet door te rekenen is.
   *
   * `null` als er hier helemaal geen product gevonden is — dán is er ook
   * niets te melden.
   */
  packagePrice: number | null;
  packagesToBuy: number | null;
  packageSize: string | null;
  productName: string | null;
  /** Het merk, voor zover de winkel dat apart meegeeft. */
  brand: string | null;
  /**
   * De productpagina bij de winkel. Bedoeld om zelf na te kijken of het echt
   * hetzelfde product is: de app zegt "gelijkwaardig", de winkel bewijst het.
   * `null` waar we geen betrouwbare link hebben — bij Picnic bestaat er geen
   * publieke productpagina, dus daar blijft dit altijd leeg.
   */
  productUrl: string | null;
  /** "€ 1,29 per liter" — het enige getal dat over verpakkingsgroottes heen vergelijkt. */
  unitPriceLabel: string | null;
  /** In welke eenheid die prijs staat, zodat twee cellen te vergelijken zijn. */
  unitPriceUnit: Unit | null;
  /** `null` bij Picnic: dat ís het product waarmee vergeleken wordt. */
  level: EquivalenceLevel | null;
  /** Waarom er geen bedrag staat, of waarom het niet meetelt. */
  note: string | null;
  /** Goedkoopste van de vergelijkbare cellen. */
  cheapest: boolean;
  promoLabel: string | null;
  /** Tot wanneer de actie loopt; `null` als de winkel dat niet meegeeft. */
  promoUntil: Date | null;
  /**
   * De van-prijs klopt niet met de prijsgeschiedenis. Dan mag er geen
   * actie-markering staan: een korting die geen korting is, hoort niet als
   * voordeel op het scherm.
   */
  fakeDiscount: boolean;
  /**
   * Levert de actie hier ook echt voordeel op? Komt uit de doorrekening, die
   * als enige weet hoeveel verpakkingen je nodig hebt en of de actie nog
   * loopt.
   */
  promotionCounts: boolean;
  stale: boolean;
}

/**
 * Mag deze cel een actie-markering krijgen?
 *
 * Het antwoord wordt niet hier bedacht: of een actie meetelt hangt af van het
 * aantal verpakkingen en van de vraag of ze nog loopt, en dat weet alleen de
 * doorrekening. De weergavelaag hoort geen tweede, net iets andere versie van
 * die regel te hebben — dat is precies hoe een scherm iets gaat beweren dat de
 * cijfers eronder tegenspreken.
 */
export function showsPromotion(cell: StoreCell): boolean {
  return cell.promotionCounts && cell.promoLabel !== null;
}

function unitPriceLabelOf(amount: number | null, unit: Unit | null): string | null {
  if (amount === null || unit === null) return null;
  return formatUnitPrice({ amount, unit });
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
      // Ons eigen product: hier ís de prijs per verpakking al wat er staat.
      packagePrice: line.referencePrice,
      packagesToBuy: line.referencePackages,
      packageSize: line.referencePackageSize,
      productName: line.referenceName,
      brand: line.referenceBrand,
      // Picnic heeft geen publieke productpagina; een verzonnen link zou op een
      // foutmelding uitkomen en dat is erger dan geen link.
      productUrl: null,
      unitPriceLabel: unitPriceLabelOf(line.referenceUnitPrice, line.referenceUnitPriceUnit),
      unitPriceUnit: line.referenceUnitPriceUnit,
      level: null,
      note: line.referenceName === null ? "nog geen product gekozen" : line.referenceCost === null ? "prijs onbekend" : null,
      cheapest: false,
      promoLabel: null,
      promoUntil: null,
      fakeDiscount: false,
      promotionCounts: false,
      stale: false,
    },
  ];

  for (const provider of providers) {
    const store = line.stores.get(provider);
    if (!store) {
      cells.push({
        provider,
        cost: null,
        packagePrice: null,
        packagesToBuy: null,
        packageSize: null,
        productName: null,
        brand: null,
        productUrl: null,
        unitPriceLabel: null,
        unitPriceUnit: null,
        level: null,
        // Nadrukkelijk niet € 0: niet gevonden is iets anders dan gratis.
        note: "niet gevonden",
        cheapest: false,
        promoLabel: null,
        promoUntil: null,
        fakeDiscount: false,
        promotionCounts: false,
        stale: false,
      });
      continue;
    }

    cells.push({
      provider,
      cost: store.cost,
      packagePrice: store.packagePrice,
      packagesToBuy: store.packagesToBuy,
      packageSize: store.packageSize,
      productName: store.name,
      brand: store.brand,
      productUrl: store.productUrl,
      unitPriceLabel: unitPriceLabelOf(store.unitPrice, store.unitPriceUnit),
      unitPriceUnit: store.unitPriceUnit,
      level: store.level,
      note: store.missingReason ?? (store.level === "ALTERNATIEF" ? EQUIVALENCE_LABELS.ALTERNATIEF : null),
      cheapest: false,
      promoLabel: store.promoLabel,
      promoUntil: store.promoUntil,
      fakeDiscount: store.fakeDiscount,
      promotionCounts: store.promotionCounts,
      stale: store.stale,
    });
  }

  // Twee eenheidsprijzen naast elkaar die niet over dezelfde eenheid gaan, is
  // geen vergelijking maar een valstrik: bij een ingrediënt in stuks kan de
  // Picnic-cel "€ 2,29 per stuk" tonen terwijl Albert Heijn voor hetzelfde
  // product "per kilo" meegeeft. In de smalle cel scheelt dat één woordje.
  // Dan liever nergens een eenheidsprijs dan twee die je niet naast elkaar
  // mag leggen — het uitklapblok toont ze nog wel, met ruimte eromheen.
  const units = new Set(
    cells.filter((cell) => cell.unitPriceLabel !== null).map((cell) => cell.unitPriceUnit)
  );
  if (units.size > 1) {
    for (const cell of cells) cell.unitPriceLabel = null;
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

/**
 * Waarom telt deze winkel niet mee in het totaal?
 *
 * Bestaat omdat de eerdere versie hiervan op het scherm aannam wat de reden
 * was ("staat er als 'ander soort' bij") terwijl de regels eronder soms iets
 * anders zeiden — precies de tegenstrijdigheid die dit scherm moet vermijden.
 * De reden wordt daarom uit de regels zelf afgeleid, niet verondersteld.
 *
 * `null` betekent: er valt niets toe te lichten, deze winkel telt gewoon mee.
 */
export function describeUncomparableStore(
  lines: BasketLineResult[],
  provider: ProductProvider,
  label: string
): string | null {
  const results = lines.map((line) => line.stores.get(provider)).filter((store) => store !== undefined);
  const withPrice = results.filter((store) => store.cost !== null);
  if (withPrice.some((store) => countsAsHardMatch(store.level) && store.missingReason === null)) {
    return null;
  }

  if (withPrice.length === 0) {
    return `Van ${label} hebben we nog geen prijzen. Dat is geen € 0 — die winkel is hier gewoon nog niet te vergelijken.`;
  }

  const alternatives = withPrice.filter((store) => store.level === "ALTERNATIEF").length;
  const ownPriceMissing = withPrice.filter(
    (store) => store.missingReason === "onze eigen prijs is onbekend"
  ).length;

  // Eén formulering die in álle gevallen waar is, met de precieze reden erbij
  // waar we die kennen. De regels eronder vertellen het verhaal per product.
  const detail =
    alternatives > 0 && ownPriceMissing > 0
      ? " Bij een deel staat een ander soort product, bij een deel kennen we onze eigen prijs niet."
      : alternatives > 0
        ? " Wat er staat is een ander soort product."
        : ownPriceMissing > 0
          ? " Onze eigen prijs kennen we hier niet, dus valt er niets naast te leggen."
          : "";

  return `Van ${label} hebben we wel prijzen, maar geen enkele regel telt mee in het totaal.${detail} Per regel staat eronder waarom.`;
}
