import type { Unit } from "@/generated/prisma/enums";

/**
 * Prijzen vergelijkbaar maken tussen winkels.
 *
 * De aanleiding staat in de opdracht: AH verkoopt melk per liter, Dirk in
 * dezelfde categorie vaak per halve liter. Twee prijzen naast elkaar leggen
 * zegt dan niets — €1,90 voor een halve liter is duurder dan €1,29 voor een
 * hele, en dat zie je pas als je allebei naar €/liter omrekent.
 *
 * Alles wordt genormaliseerd naar de basiseenheden die de app al gebruikt
 * (GRAM, ML, PIECE), zodat dit domein niet zijn eigen eenhedenstelsel
 * introduceert naast `src/lib/quantity/units.ts`.
 */

export interface UnitPrice {
  /** Prijs per gram, per milliliter of per stuk. */
  amount: number;
  unit: Unit;
}

/**
 * Woorden waarmee een verpakking een áántal aangeeft in plaats van een gewicht
 * of een inhoud.
 *
 * Dit lijstje was vier woorden lang, en dat kostte precies wat je zou
 * verwachten: "9 rollen" toiletpapier was helemaal niet te lezen. Erger dan
 * een ontbrekende eenheidsprijs, want zonder inhoud kan de vergelijking niet
 * zíén dat negen rollen iets anders is dan twaalf stuks — en dan telt ze het
 * duurdere pak stilzwijgend mee als gelijkwaardig.
 *
 * Bewust alleen woorden die onmiskenbaar een telbaar ding aanduiden. Twijfel
 * hoort hier niet thuis: een verkeerd gelezen verpakking is erger dan een
 * ontbrekende, want die laatste leidt tot "niet te vergelijken" en de eerste
 * tot een bedrag dat overtuigend en fout is.
 */
const COUNT_WORDS = [
  "stuks?",
  "st\\.?",
  "rollen|rol",
  "zakjes|zakje|zakken|zak",
  "plakken|plak",
  "sneetjes|sneetje",
  "bollen|bol",
  "blikken|blik",
  "flessen|fles",
  "pakken|pak",
  "tabletten|tablet",
  "capsules|capsule",
  "doekjes|doekje",
  "wasbeurten|wasbeurt",
  "repen|reep",
  "kroppen|krop",
  "bosjes|bosje|bos",
].join("|");

/**
 * Leest een verpakkingsgrootte zoals winkels die opschrijven en geeft de
 * inhoud in basiseenheden terug.
 *
 * Bewust conservatief: alles wat niet ondubbelzinnig te lezen is geeft `null`
 * en geen gok. Een verkeerd gelezen verpakkingsgrootte is erger dan een
 * ontbrekende — die laatste leidt tot "niet vergelijkbaar", de eerste tot een
 * prijsvergelijking die er overtuigend uitziet en fout is.
 */
export function parsePackContent(salesUnitSize: string | null | undefined): { amount: number; unit: Unit } | null {
  if (!salesUnitSize) return null;
  const text = salesUnitSize.toLowerCase().replace(",", ".").trim();

  // "2 x 350 g", "6 x 500 ml" — een multipack is het product van beide.
  const multi = text.match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(g|gram|kg|ml|l|liter|cl)\b/);
  if (multi) {
    const scaled = scaleToBase(Number(multi[1]) * Number(multi[2]), multi[3]);
    return scaled;
  }

  const single = text.match(/^(?:ca\.?\s*)?(\d+(?:\.\d+)?)\s*(g|gram|kg|ml|l|liter|cl)\b/);
  if (single) return scaleToBase(Number(single[1]), single[2]);

  // "6 stuks", "1 stuk", "4 st", "9 rollen", "12 zakjes"
  const pieces = text.match(new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*(?:${COUNT_WORDS})\\b`));
  if (pieces) return { amount: Number(pieces[1]), unit: "PIECE" };

  // "per stuk" zonder getal telt als één.
  if (/^per stuk$|^stuk$/.test(text)) return { amount: 1, unit: "PIECE" };

  return null;
}

function scaleToBase(amount: number, rawUnit: string): { amount: number; unit: Unit } | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  switch (rawUnit) {
    case "g":
    case "gram":
      return { amount, unit: "GRAM" };
    case "kg":
      return { amount: amount * 1000, unit: "GRAM" };
    case "ml":
      return { amount, unit: "ML" };
    case "cl":
      return { amount: amount * 10, unit: "ML" };
    case "l":
    case "liter":
      return { amount: amount * 1000, unit: "ML" };
    default:
      return null;
  }
}

/** Prijs per basiseenheid, of `null` als de inhoud niet betrouwbaar bekend is. */
export function unitPriceFor(price: number, content: { amount: number; unit: Unit } | null): UnitPrice | null {
  if (!content || content.amount <= 0 || !Number.isFinite(price) || price < 0) return null;
  return { amount: price / content.amount, unit: content.unit };
}

/**
 * Leest de kant-en-klare eenheidsprijs die Albert Heijn meelevert
 * ("prijs per liter €1.29"). Sneller én betrouwbaarder dan zelf delen, maar
 * alleen als de eenheid herkenbaar is.
 */
export function parseUnitPriceDescription(description: string | null | undefined): UnitPrice | null {
  if (!description) return null;
  const text = description.toLowerCase().replace(",", ".");
  const match = text.match(/per\s+(liter|l|kilo|kilogram|kg|stuk|100\s*g|100\s*ml)\D*(\d+(?:\.\d+)?)/);
  if (!match) return null;

  const price = Number(match[2]);
  if (!Number.isFinite(price) || price < 0) return null;

  switch (match[1].replace(/\s+/g, "")) {
    case "liter":
    case "l":
      return { amount: price / 1000, unit: "ML" };
    case "kilo":
    case "kilogram":
    case "kg":
      return { amount: price / 1000, unit: "GRAM" };
    case "100g":
      return { amount: price / 100, unit: "GRAM" };
    case "100ml":
      return { amount: price / 100, unit: "ML" };
    case "stuk":
      return { amount: price, unit: "PIECE" };
    default:
      return null;
  }
}

const UNIT_LABEL: Record<Unit, string> = { GRAM: "kilo", ML: "liter", PIECE: "stuk" };
const UNIT_FACTOR: Record<Unit, number> = { GRAM: 1000, ML: 1000, PIECE: 1 };

/** "€ 1,29 per liter" — de vorm waarin een mens dit leest. */
export function formatUnitPrice(unitPrice: UnitPrice | null): string | null {
  if (!unitPrice) return null;
  const perDisplayUnit = unitPrice.amount * UNIT_FACTOR[unitPrice.unit];
  return `€ ${perDisplayUnit.toFixed(2).replace(".", ",")} per ${UNIT_LABEL[unitPrice.unit]}`;
}
