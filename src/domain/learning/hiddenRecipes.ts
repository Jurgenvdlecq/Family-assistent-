const HIDE_THRESHOLD = 2;

export type HidingSignal = {
  eventType: "CHOSEN" | "REPLACED" | "IGNORED" | "EXPLICIT_FEEDBACK" | "RESTORED";
  reason?: string | null;
  context: unknown;
  createdAt: Date;
};

function isExplicitNegative(context: unknown): boolean {
  if (context && typeof context === "object" && "positive" in context) {
    return (context as { positive?: unknown }).positive === false;
  }
  return false;
}

/**
 * Fase 11: "één negatieve beoordeling verlaagt de score" (dat doet
 * recalculateVariantConfidence al) — "meerdere negatieve beoordelingen
 * kunnen een gerecht verbergen" is hier apart. Alleen signalen die echt een
 * smaak-afkeur uitdrukken tellen mee: een expliciete duim-omlaag, of een
 * vervanging met NOT_TASTY/NEVER_USE als reden (dezelfde twee zwaarst
 * gewogen redenen als replacementPenaltyForReason). Contextuele redenen
 * (verkeerde dag, te veel werk vandaag) zeggen niets over het gerecht zelf
 * en tellen daarom niet mee. Na een RESTORED-event tellen alleen nieuwe
 * signalen daarna mee, zodat herstellen ook echt herstelt.
 */
export function deriveHiddenState(events: HidingSignal[]): {
  hidden: boolean;
  negativeSignalCount: number;
} {
  const restoredAt = events.reduce<Date | null>((latest, event) => {
    if (event.eventType !== "RESTORED") return latest;
    return !latest || event.createdAt > latest ? event.createdAt : latest;
  }, null);

  const negativeSignalCount = events.filter((event) => {
    if (restoredAt && event.createdAt <= restoredAt) return false;
    if (event.eventType === "EXPLICIT_FEEDBACK") return isExplicitNegative(event.context);
    if (event.eventType === "REPLACED") return event.reason === "NOT_TASTY" || event.reason === "NEVER_USE";
    return false;
  }).length;

  return { hidden: negativeSignalCount >= HIDE_THRESHOLD, negativeSignalCount };
}
