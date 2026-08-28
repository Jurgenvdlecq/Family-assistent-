import { logEvent } from "@/lib/logger";

/**
 * Hoeveel producten liggen er op dit moment in het echte Picnic-mandje?
 *
 * Gebruikt om te herkennen dat een bestelling waarschijnlijk geplaatst is:
 * wij weten welke regels we in het mandje hebben gelegd, dus als dat mandje
 * daarna leeg is, is afrekenen de meest voor de hand liggende verklaring.
 *
 * Geeft `null` bij alles wat we niet met zekerheid kunnen lezen. Dat is hier
 * belangrijker dan een slimme gok: op basis van dit getal vraagt de app of
 * er besteld is, en die vraag mag niet gesteld worden op grond van een
 * verkeerd gelezen respons. `null` betekent dus "ik weet het niet" en leidt
 * tot geen enkele conclusie — nooit tot "dus leeg".
 *
 * De Picnic-API is niet gedocumenteerd (R1); vandaar de defensieve vorm-
 * controle in plaats van vertrouwen op één veld.
 */
export function parseCartItemCount(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") {
    logEvent({
      level: "warn",
      area: "picnic_cart",
      message: "Onverwachte vorm van de Picnic-mandjerespons",
      meta: { type: typeof raw },
    });
    return null;
  }

  const cart = raw as { total_count?: unknown; items?: unknown };

  // Picnic geeft normaal een expliciete telling mee — die is het meest
  // betrouwbaar, want hij telt losse producten en niet regels.
  if (typeof cart.total_count === "number" && Number.isFinite(cart.total_count) && cart.total_count >= 0) {
    return cart.total_count;
  }

  // Terugval: het aantal regels in het mandje. Voor de enige vraag die we
  // ermee stellen ("is het mandje leeg?") is dat genoeg.
  if (Array.isArray(cart.items)) {
    return cart.items.length;
  }

  logEvent({
    level: "warn",
    area: "picnic_cart",
    message: "Kon het aantal producten in het Picnic-mandje niet bepalen",
    meta: { keys: Object.keys(cart).slice(0, 10) },
  });
  return null;
}
