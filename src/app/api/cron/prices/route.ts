import { headers } from "next/headers";
import { refreshAllStorePrices } from "@/lib/pricing/refresh";
import { logEvent, createCorrelationId, errorMessage } from "@/lib/logger";

/**
 * Dagelijkse prijsverversing, aangeroepen door een cron (Vercel Cron).
 *
 * Bewust een geplande taak en nooit tijdens het laden van een pagina: een
 * paar honderd zoekopdrachten horen niet in een paginaverzoek, en een
 * bezoeker mag nooit op een externe winkel hoeven wachten.
 *
 * Zelfde dunne, geauthenticeerde wrapper als de herinneringen-cron: alle
 * regels (welke ingrediënten, spreiding, afbreken bij storing) staan in
 * src/lib/pricing/refresh.ts.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    logEvent({
      level: "error",
      area: "pricing",
      message: "CRON_SECRET ontbreekt",
      correlationId: createCorrelationId(),
    });
    return new Response("Server niet geconfigureerd.", { status: 500 });
  }

  const headerList = await headers();
  const authHeader = headerList.get("authorization") ?? request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return new Response("Niet geautoriseerd.", { status: 401 });
  }

  try {
    const results = await refreshAllStorePrices();
    // Een verversing die niets opleverde is een storing, geen uitslag — dat
    // moet ook in de HTTP-status te zien zijn, anders staat de cron op groen
    // terwijl de prijzen bevriezen.
    // Twee vormen van "niets opgeleverd", allebei een storing: wél gezocht
    // maar niets gevonden, en helemaal niet aan zoeken toegekomen (zoals een
    // mislukte Dirk-crawl, die vóór de ingrediënten afbreekt).
    const failed = results.some(
      (result) =>
        result.productsStored === 0 && (result.ingredientsChecked > 0 || result.errors.length > 0)
    );
    return Response.json({ results }, { status: failed ? 500 : 200 });
  } catch (error) {
    logEvent({
      level: "error",
      area: "pricing",
      message: "Prijsverversing mislukt",
      correlationId: createCorrelationId(),
      meta: { error: errorMessage(error) },
    });
    return new Response("Prijsverversing mislukt.", { status: 500 });
  }
}
