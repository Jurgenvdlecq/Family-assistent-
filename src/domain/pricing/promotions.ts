import type { PromoType } from "@/generated/prisma/enums";

/**
 * Wat een actie écht oplevert bij het aantal verpakkingen dat je koopt.
 *
 * Dit is nodig omdat een kortingslabel geen prijs is. "1+1 gratis" is geen 50%
 * korting: koop je er drie, dan betaal je er twee — dat is 33%. En "2e halve
 * prijs" bij één stuk is helemaal geen korting. Het bedrag op het scherm hoort
 * te kloppen met wat er in het mandje gebeurt, niet met wat er op het bordje
 * staat.
 *
 * De belangrijkste regel staat onderaan: **een mechanisme dat we niet zeker
 * herkennen wordt niet toegepast**. Dan blijft de gewone prijs staan en zie je
 * het label er los bij. Een verzonnen korting is erger dan een gemiste — de
 * eerste maakt het bedrag fout, de tweede alleen voorzichtig.
 */

export type PromoMechanism =
  /** "1+1 gratis", "2+1 gratis": per groep van (betaald + gratis) betaal je er `paid`. */
  | { kind: "X_PLUS_Y_GRATIS"; paid: number; free: number }
  /** "2e halve prijs": in elk paar kost de tweede de helft. */
  | { kind: "TWEEDE_HALVE_PRIJS" }
  /** "3 voor 2": per groep van `groupSize` betaal je er `paidCount`. */
  | { kind: "X_VOOR_Y"; groupSize: number; paidCount: number }
  /** "2 voor € 3,00": een vaste prijs per groep. */
  | { kind: "X_VOOR_BEDRAG"; groupSize: number; groupPrice: number }
  /** "25% korting". */
  | { kind: "PERCENTAGE"; percent: number };

function normalize(label: string): string {
  return label.toLowerCase().replace(",", ".").replace(/\s+/g, " ").trim();
}

/**
 * Leest het mechanisme uit het label zoals de winkel het opschrijft.
 *
 * `null` betekent: niet zeker genoeg. Dat is een geldige uitkomst en geen
 * tekortkoming — de meeste kortingen zijn gewoon een lagere prijs, en die
 * staat al in de prijs zelf.
 */
export function parsePromoMechanism(label: string | null | undefined): PromoMechanism | null {
  if (!label) return null;
  const text = normalize(label);

  // "2 voor 3.00", "2 voor € 3,00" — let op de volgorde: dit moet vóór
  // "x voor y" komen, anders wordt het bedrag als aantal gelezen.
  const forAmount = text.match(/(\d+)\s*voor\s*€?\s*(\d+\.\d{2})\b/);
  if (forAmount) {
    const groupSize = Number(forAmount[1]);
    const groupPrice = Number(forAmount[2]);
    if (groupSize >= 2 && groupPrice > 0) return { kind: "X_VOOR_BEDRAG", groupSize, groupPrice };
  }

  // "1+1 gratis", "2+1 gratis"
  const plus = text.match(/(\d+)\s*\+\s*(\d+)\s*gratis/);
  if (plus) {
    const paid = Number(plus[1]);
    const free = Number(plus[2]);
    if (paid >= 1 && free >= 1) return { kind: "X_PLUS_Y_GRATIS", paid, free };
  }

  // "2e halve prijs", "tweede halve prijs"
  if (/(2e|tweede)\s+halve\s+prijs/.test(text)) return { kind: "TWEEDE_HALVE_PRIJS" };

  // "3 voor 2", "3 halen 2 betalen"
  const forCount = text.match(/(\d+)\s*(?:voor|halen)\s*(\d+)\s*(?:betalen)?\b/);
  if (forCount) {
    const groupSize = Number(forCount[1]);
    const paidCount = Number(forCount[2]);
    if (groupSize > paidCount && paidCount >= 1) return { kind: "X_VOOR_Y", groupSize, paidCount };
  }

  const percent = text.match(/(\d{1,2})\s*%\s*korting/);
  if (percent) {
    const value = Number(percent[1]);
    if (value > 0 && value < 100) return { kind: "PERCENTAGE", percent: value };
  }

  return null;
}

export interface PromoOutcome {
  /** Wat je in totaal betaalt voor dit aantal verpakkingen. */
  cost: number;
  /** Wat het zonder de actie gekost zou hebben. */
  costWithoutPromo: number;
  /** In gewone taal, of `null` als er niets toe te lichten valt. */
  explanation: string | null;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

/**
 * Wat kost dit aantal verpakkingen, met de actie erop toegepast?
 *
 * Zonder herkend mechanisme is het antwoord simpelweg aantal × prijs. Dat is
 * bewust: dan is het bedrag niet te laag, hooguit niet zo laag als het in de
 * winkel wordt.
 */
export function applyPromotion(
  packages: number,
  unitPrice: number,
  mechanism: PromoMechanism | null
): PromoOutcome {
  const plain = round2(packages * unitPrice);
  if (!mechanism || packages <= 0) {
    return { cost: plain, costWithoutPromo: plain, explanation: null };
  }

  switch (mechanism.kind) {
    case "X_PLUS_Y_GRATIS": {
      const groupSize = mechanism.paid + mechanism.free;
      const fullGroups = Math.floor(packages / groupSize);
      const remainder = packages % groupSize;
      // In een onvolledige groep betaal je gewoon voor wat je meeneemt — maar
      // nooit meer dan het betaalde deel van een hele groep.
      const paidUnits = fullGroups * mechanism.paid + Math.min(remainder, mechanism.paid);
      return {
        cost: round2(paidUnits * unitPrice),
        costWithoutPromo: plain,
        explanation:
          paidUnits < packages
            ? `${packages} halen, ${paidUnits} betalen`
            : // Bij één stuk levert "1+1 gratis" niets op. Dat eerlijk zeggen is
              // beter dan een korting suggereren die je niet krijgt.
              `je krijgt pas voordeel vanaf ${groupSize} stuks`,
      };
    }

    case "TWEEDE_HALVE_PRIJS": {
      const pairs = Math.floor(packages / 2);
      const rest = packages % 2;
      const cost = round2((pairs * 1.5 + rest) * unitPrice);
      return {
        cost,
        costWithoutPromo: plain,
        explanation: pairs > 0 ? `${pairs}× de tweede voor de helft` : "je krijgt pas voordeel vanaf 2 stuks",
      };
    }

    case "X_VOOR_Y": {
      const fullGroups = Math.floor(packages / mechanism.groupSize);
      const remainder = packages % mechanism.groupSize;
      const paidUnits = fullGroups * mechanism.paidCount + Math.min(remainder, mechanism.paidCount);
      return {
        cost: round2(paidUnits * unitPrice),
        costWithoutPromo: plain,
        explanation:
          paidUnits < packages
            ? `${packages} halen, ${paidUnits} betalen`
            : `je krijgt pas voordeel vanaf ${mechanism.groupSize} stuks`,
      };
    }

    case "X_VOOR_BEDRAG": {
      const fullGroups = Math.floor(packages / mechanism.groupSize);
      const remainder = packages % mechanism.groupSize;
      const cost = round2(fullGroups * mechanism.groupPrice + remainder * unitPrice);
      return {
        cost,
        costWithoutPromo: plain,
        explanation:
          fullGroups > 0
            ? `${fullGroups}× ${mechanism.groupSize} voor € ${mechanism.groupPrice.toFixed(2).replace(".", ",")}`
            : `je krijgt pas voordeel vanaf ${mechanism.groupSize} stuks`,
      };
    }

    case "PERCENTAGE": {
      return {
        cost: round2(plain * (1 - mechanism.percent / 100)),
        costWithoutPromo: plain,
        explanation: `${mechanism.percent}% korting`,
      };
    }
  }
}

/**
 * Loopt de actie nog?
 *
 * Een verlopen actie toepassen zou een bedrag opleveren dat je in de winkel
 * niet krijgt. Geen einddatum betekent "onbekend" en dus gewoon toepassen —
 * niet elke winkel geeft er een.
 */
export function promotionIsActive(promoUntil: Date | null, now: Date = new Date()): boolean {
  if (!promoUntil) return true;
  return promoUntil.getTime() >= now.getTime();
}

/** Alleen mechanische kortingen hebben een aparte berekening nodig. */
export function hasMechanism(promoType: PromoType): boolean {
  return promoType === "X_VOOR_Y" || promoType === "VOLUME";
}
