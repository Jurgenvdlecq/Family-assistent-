/**
 * Pure selectielogica voor `getLegacySingleHousehold` (`src/lib/auth.ts`).
 * Losstaand van `auth.ts` gehouden (dat bestand importeert `server-only` en
 * `next/headers`, en is daardoor niet los in `tsx --test` te importeren —
 * zelfde reden als `credentials.ts`) zodat dit gedrag wél zonder een echte
 * Next.js-requestcontext getest kan worden.
 */
export interface LegacyAccessCandidate {
  username: string | null;
  createdAt: Date;
}

/**
 * Vaste grens (SYSTEM_AUDIT.md-vervolg, deel B): sinds WP77 zet elke
 * onboarding altijd meteen een gebruikersnaam, dus een normaal aangemaakt
 * huishouden kan hier nooit meer in aanmerking voor komen. Deze datum sluit
 * dat gedeelte van de audit-bevinding definitief af — alleen een huishouden
 * dat al vóór deze wijziging bestond, komt nog in aanmerking. Zie
 * `auth.ts` voor de volledige toelichting.
 */
export const LEGACY_SINGLE_HOUSEHOLD_CUTOFF = new Date("2026-07-31T00:00:00.000Z");

/** `null` zodra er geen ondubbelzinnig legacy-huishouden is om stilzwijgend toegang toe te geven. */
export function selectLegacySingleHousehold<T extends LegacyAccessCandidate>(
  households: T[],
  cutoff: Date = LEGACY_SINGLE_HOUSEHOLD_CUTOFF
): T | null {
  if (households.length === 1 && households[0].username === null && households[0].createdAt < cutoff) {
    return households[0];
  }
  return null;
}
