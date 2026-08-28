import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { DayKey } from "@/lib/week";

/**
 * Gedeeld tussen `src/app/actions.ts` en `src/app/gerechten/actions.ts` — los
 * gehouden van beide (in plaats van geëxporteerd vanuit een van de twee)
 * omdat een `"use server"`-bestand alleen async functies mag exporteren;
 * dit is een gewone synchrone helper.
 *
 * `revalidatePath` alleen is niet genoeg om de gebruiker te laten zien dat
 * een actie is gelukt: zonder een echte navigatie blijft de al open
 * homepage soms de oude staat tonen. Een redirect terug naar `/` dwingt een
 * verse render af én toont een expliciete groene bevestiging (zie
 * STATUS_MESSAGES in page.tsx) — dezelfde aanpak als /boodschappen en
 * /recepten.
 *
 * `focusDayKey` (optioneel): voor acties die bij één specifieke dag horen —
 * zonder dit spring je terug naar de bovenkant van de pagina en moet je
 * opnieuw naar de juiste dag scrollen. `page.tsx` gebruikt dit om terug te
 * scrollen naar `#day-<dayKey>` — zelfde `focus`+hash-patroon als
 * /boodschappen en /controle.
 *
 * `openDayDetails` (optioneel, standaard `true`): of "Meer voor deze dag"
 * voor die dag ook meteen openklapt.
 */
export function redirectToHome(status: string, focusDayKey?: DayKey, openDayDetails = true): never {
  revalidatePath("/week");
  const params = new URLSearchParams({ status });
  if (focusDayKey) {
    params.set("focusDay", focusDayKey);
    if (!openDayDetails) params.set("openDetails", "0");
    redirect(`/week?${params.toString()}#day-${focusDayKey}`);
  }
  redirect(`/week?${params.toString()}`);
}
