import type { AttentionItem, AttentionItemType } from "./attentionItems";

/**
 * WP70: hoe lang een attention-item al waar moet zijn vóórdat de pushlaag
 * er iets over mag sturen — bewust géén onderdeel van attentionItems.ts
 * zelf (die laag toont een item altijd meteen aan de gebruiker in de app;
 * dit is puur pushbeleid, zodat push geen businesslogica dupliceert, enkel
 * er beleid bovenop legt). 2 dagen voor productcontrole is expliciet
 * gevraagd; de overige drempels zijn een conservatieve eigen invulling.
 */
export const NOTIFICATION_DWELL_THRESHOLD_MS: Record<AttentionItemType, number> = {
  WEEK_MENU_READY_NO_GROCERIES: 24 * 60 * 60 * 1000,
  PRODUCT_REVIEW_OPEN: 2 * 24 * 60 * 60 * 1000,
  GROCERIES_READY_NOT_SENT_TO_PICNIC: 24 * 60 * 60 * 1000,
  PICNIC_CART_FILLED_NOT_CONFIRMED: 2 * 60 * 60 * 1000,
};

const NOTIFICATION_TIME_ZONE = "Europe/Amsterdam";

/** "08:00–21:00 lokale tijd" — vast op Europe/Amsterdam voor v1 (NL/BE-only app). */
export function isWithinNotificationWindow(now: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: NOTIFICATION_TIME_ZONE, hour: "2-digit", hour12: false }).format(now)
  );
  return hour >= 8 && hour < 21;
}

/** Kalenderdag in Europe/Amsterdam, bijv. "2026-07-30" — voor de dagelijkse dedupe. */
export function notificationDayKey(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NOTIFICATION_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

/**
 * Kiest maximaal één attention-item om nu te versturen, of `null` als er
 * niets te sturen valt. Bewust géén businesslogica over "wat is er aan de
 * hand" (dat is attentionItems.ts) — alleen wanneer/hoe vaak we daarover
 * mogen mailen: voorkeur per type, al gestuurd vandaag (per type en per
 * huishouden), en de wachttijd sinds `relevantSince`.
 */
export function selectNotificationToSend(input: {
  items: AttentionItem[];
  now: Date;
  preferenceEnabledByType: Partial<Record<AttentionItemType, boolean>>;
  typesAlreadySentToday: ReadonlySet<AttentionItemType>;
  householdAlreadySentAnyToday: boolean;
}): AttentionItem | null {
  if (input.householdAlreadySentAnyToday) return null;

  for (const item of input.items) {
    const enabled = input.preferenceEnabledByType[item.type] ?? true;
    if (!enabled) continue;
    if (input.typesAlreadySentToday.has(item.type)) continue;
    const dwellMs = NOTIFICATION_DWELL_THRESHOLD_MS[item.type];
    if (input.now.getTime() - item.relevantSince.getTime() < dwellMs) continue;
    return item;
  }
  return null;
}
