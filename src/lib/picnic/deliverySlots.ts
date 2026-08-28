import { logEvent } from "@/lib/logger";
import { picnicPriceToEuros } from "./products";
import { DAY_KEYS, DAY_KEY_BY_ENUM, DAY_LABELS, type DayKey } from "@/lib/week";
import type { DayOfWeek } from "@/generated/prisma/enums";

export type PicnicDeliverySlot = {
  id: string;
  windowStart: Date;
  windowEnd: Date;
  isAvailable: boolean;
  selected?: boolean;
  minimumOrderValue?: number;
};

export type PreferredDeliverySlotStatusValue =
  | "AVAILABLE"
  | "EXACT_TIME_UNAVAILABLE"
  | "NO_NEARBY_SLOTS"
  | "NO_SLOTS_FOR_DAY"
  | "UNKNOWN";

export type PreferredDeliverySlotStatus = {
  status: PreferredDeliverySlotStatusValue;
  preferredSlot?: PicnicDeliverySlot;
  nearbySlots: PicnicDeliverySlot[];
  message: string;
};

interface RawSlotShape {
  slot_id?: unknown;
  id?: unknown;
  window_start?: unknown;
  window_end?: unknown;
  is_available?: unknown;
  selected?: unknown;
  minimum_order_value?: unknown;
  min_order_value?: unknown;
}

function parseOneSlot(raw: unknown): PicnicDeliverySlot | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as RawSlotShape;

  const rawId = candidate.slot_id ?? candidate.id;
  if (typeof rawId !== "string" && typeof rawId !== "number") return null;

  const windowStart = candidate.window_start ? new Date(String(candidate.window_start)) : null;
  const windowEnd = candidate.window_end ? new Date(String(candidate.window_end)) : null;
  if (!windowStart || Number.isNaN(windowStart.getTime())) return null;
  if (!windowEnd || Number.isNaN(windowEnd.getTime())) return null;

  const minimumOrderValueRaw = candidate.minimum_order_value ?? candidate.min_order_value;

  return {
    id: String(rawId),
    windowStart,
    windowEnd,
    isAvailable: candidate.is_available === true,
    selected: candidate.selected === true,
    minimumOrderValue:
      typeof minimumOrderValueRaw === "number" ? (picnicPriceToEuros(minimumOrderValueRaw) ?? undefined) : undefined,
  };
}

/**
 * Vertaalt de ruwe, niet-officiële Picnic-respons naar een stabiel intern
 * formaat. Nooit gooien: een individuele regel die niet te herkennen is
 * wordt overgeslagen in plaats van de hele lijst te laten mislukken — als
 * Picnic iets aan de vorm wijzigt (R1), moet dit een lege/onvolledige lijst
 * opleveren, geen crash.
 */
export function parseDeliverySlotsResponse(raw: unknown): PicnicDeliverySlot[] {
  if (!Array.isArray(raw)) {
    logEvent({
      level: "warn",
      area: "picnic_delivery_slots",
      message: "Onverwachte vorm van Picnic-bezorgmomenten-respons (geen array)",
      meta: { type: typeof raw },
    });
    return [];
  }
  const slots = raw.map(parseOneSlot).filter((slot): slot is PicnicDeliverySlot => slot !== null);
  if (raw.length > 0 && slots.length === 0) {
    logEvent({
      level: "warn",
      area: "picnic_delivery_slots",
      message: "Geen enkel bezorgmoment kon worden herkend uit de Picnic-respons",
      meta: { rawCount: raw.length },
    });
  }
  return slots;
}

function parsePreferredTime(preferredTime: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(preferredTime.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

// Alle dag/tijd-vergelijkingen gebeuren bewust in Europe/Amsterdam-tijd, niet
// in de tijdzone van de server (die draait op Vercel in UTC) — zelfde reden
// als isWithinNotificationWindow in notificationPolicy.ts: "18:00" en
// "vrijdag" zijn wat het huishouden bedoelt in Nederlandse lokale tijd.
const TIME_ZONE = "Europe/Amsterdam";
const WEEKDAY_TO_DAY_KEY: Record<string, DayKey> = {
  Mon: "monday",
  Tue: "tuesday",
  Wed: "wednesday",
  Thu: "thursday",
  Fri: "friday",
  Sat: "saturday",
  Sun: "sunday",
};

function amsterdamDayKeyAndMinutes(date: Date): { dayKey: DayKey; minutesSinceMidnight: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    dayKey: WEEKDAY_TO_DAY_KEY[lookup.weekday],
    minutesSinceMidnight: Number(lookup.hour) * 60 + Number(lookup.minute),
  };
}

/** Overlapt het tijdvak [start,end) van een slot met [target-marge, target+marge)? */
function slotOverlapsWindow(slot: PicnicDeliverySlot, targetMinutes: number, windowMinutes: number): boolean {
  const slotStartMin = amsterdamDayKeyAndMinutes(slot.windowStart).minutesSinceMidnight;
  const slotEndMin = amsterdamDayKeyAndMinutes(slot.windowEnd).minutesSinceMidnight;
  const rangeStart = targetMinutes - windowMinutes;
  const rangeEnd = targetMinutes + windowMinutes;
  return slotStartMin < rangeEnd && slotEndMin > rangeStart;
}

function targetFallsWithinSlot(slot: PicnicDeliverySlot, targetMinutes: number): boolean {
  const slotStartMin = amsterdamDayKeyAndMinutes(slot.windowStart).minutesSinceMidnight;
  const slotEndMin = amsterdamDayKeyAndMinutes(slot.windowEnd).minutesSinceMidnight;
  return targetMinutes >= slotStartMin && targetMinutes < slotEndMin;
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("nl-NL", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(date);
}

/** "18:00–19:00" — het tijdvak van één bezorgmoment, in Nederlandse tijd. */
export function formatSlotWindow(slot: PicnicDeliverySlot): string {
  return `${formatTime(slot.windowStart)}–${formatTime(slot.windowEnd)}`;
}

/** "2026-09-04" in Europe/Amsterdam — de kalenderdag waarop een slot valt. */
function amsterdamIsoDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** "do 4 sep" */
function formatDayLabel(date: Date): string {
  const parts = new Intl.DateTimeFormat("nl-NL", {
    timeZone: TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).formatToParts(date);
  const valueOf = (type: string) => (parts.find((part) => part.type === type)?.value ?? "").replace(".", "");
  return `${valueOf("weekday")} ${valueOf("day")} ${valueOf("month")}`;
}

export type DeliveryDayGroup = {
  /** yyyy-mm-dd in Europe/Amsterdam — ook de sorteersleutel. */
  isoDate: string;
  dayKey: DayKey;
  /** "do 4 sep" */
  label: string;
  /** Alleen de nog vrije tijdvakken, op tijd gesorteerd. */
  availableSlots: PicnicDeliverySlot[];
  /** Hoeveel tijdvakken die dag al vol zitten — een dag met 0 vrije en >0 volle toont "alles vol". */
  unavailableCount: number;
};

/**
 * Bundelt de ruwe slotenlijst per bezorgdag, zodat de app kan tonen wanneer
 * er nog bezorgd kan worden in plaats van alleen of één vaste voorkeur nog
 * past.
 *
 * Bewust geen aanname over hoever Picnic vooruit kijkt: we groeperen precies
 * wat er binnenkomt en laten de UI beslissen hoeveel dagen ze meteen toont.
 * Verandert Picnic dat venster, dan verandert deze lijst gewoon mee.
 */
export function groupDeliverySlotsByDay(slots: PicnicDeliverySlot[]): DeliveryDayGroup[] {
  const byDate = new Map<string, DeliveryDayGroup>();

  for (const slot of slots) {
    const isoDate = amsterdamIsoDate(slot.windowStart);
    let group = byDate.get(isoDate);
    if (!group) {
      group = {
        isoDate,
        dayKey: amsterdamDayKeyAndMinutes(slot.windowStart).dayKey,
        label: formatDayLabel(slot.windowStart),
        availableSlots: [],
        unavailableCount: 0,
      };
      byDate.set(isoDate, group);
    }
    if (slot.isAvailable) group.availableSlots.push(slot);
    else group.unavailableCount += 1;
  }

  const groups = [...byDate.values()].sort((a, b) => a.isoDate.localeCompare(b.isoDate));
  for (const group of groups) {
    group.availableSlots.sort((a, b) => a.windowStart.getTime() - b.windowStart.getTime());
  }
  return groups;
}

/**
 * Bepaalt in gewone, uitlegbare regels of de voorkeurstijd van een
 * huishouden op de voorkeursdag (nog) beschikbaar lijkt bij Picnic. Bewust
 * geen "gegarandeerd"-taal — dit is en blijft een niet-officiële koppeling.
 * Geeft zelf nooit "UNKNOWN" terug (dat doet alleen de aanroepende laag als
 * Picnic niet bereikt kon worden) — met een geldige, geparste slotenlijst
 * weten we altijd één van de vier concrete statussen.
 */
export function findPreferredDeliverySlotStatus(input: {
  slots: PicnicDeliverySlot[];
  preferredDay: DayOfWeek;
  preferredTime: string;
  windowMinutes: number;
}): PreferredDeliverySlotStatus {
  const parsedTime = parsePreferredTime(input.preferredTime);
  const preferredDayKey = DAY_KEY_BY_ENUM[input.preferredDay];
  const dayLabel = DAY_LABELS[preferredDayKey].toLowerCase();

  if (!parsedTime) {
    return {
      status: "UNKNOWN",
      nearbySlots: [],
      message: "Voorkeurstijd kon niet worden gelezen.",
    };
  }
  const targetMinutes = parsedTime.hours * 60 + parsedTime.minutes;
  const timeLabel = input.preferredTime;

  const slotsForDay = input.slots.filter(
    (slot) => amsterdamDayKeyAndMinutes(slot.windowStart).dayKey === preferredDayKey
  );
  if (slotsForDay.length === 0) {
    return {
      status: "NO_SLOTS_FOR_DAY",
      nearbySlots: [],
      message: `Ik zie geen bezorgmomenten van Picnic voor ${dayLabel}.`,
    };
  }

  const exactMatch = slotsForDay.find((slot) => slot.isAvailable && targetFallsWithinSlot(slot, targetMinutes));
  if (exactMatch) {
    return {
      status: "AVAILABLE",
      preferredSlot: exactMatch,
      nearbySlots: [],
      message: `Volgens Picnic is er rond ${timeLabel} op ${dayLabel} een bezorgmoment beschikbaar.`,
    };
  }

  const nearbyAvailable = slotsForDay.filter(
    (slot) => slot.isAvailable && slotOverlapsWindow(slot, targetMinutes, input.windowMinutes)
  );
  if (nearbyAvailable.length > 0) {
    const times = nearbyAvailable
      .map((slot) => `${formatTime(slot.windowStart)}–${formatTime(slot.windowEnd)}`)
      .join(", ");
    return {
      status: "EXACT_TIME_UNAVAILABLE",
      nearbySlots: nearbyAvailable,
      message: `Je voorkeur voor ${timeLabel} op ${dayLabel} lijkt niet meer beschikbaar. Er zijn nog alternatieven rond ${times}.`,
    };
  }

  return {
    status: "NO_NEARBY_SLOTS",
    nearbySlots: [],
    message: `Ik zie geen bezorgmomenten meer rond ${timeLabel} op ${dayLabel}.`,
  };
}

/** "Vandaag is het 2 dagen vóór vrijdag?" — pure dag-van-de-week-rekenwerk voor de reminder-regel. */
export function shouldCheckDeliverySlotToday(input: {
  preferredDayOfWeek: DayOfWeek;
  reminderDaysBefore: number;
  now: Date;
}): boolean {
  const preferredDayKey = DAY_KEY_BY_ENUM[input.preferredDayOfWeek];
  const preferredIndex = DAY_KEYS.indexOf(preferredDayKey);
  const todayIndex = DAY_KEYS.indexOf(amsterdamDayKeyAndMinutes(input.now).dayKey);
  const daysUntilPreferred = (preferredIndex - todayIndex + 7) % 7;
  return daysUntilPreferred === input.reminderDaysBefore;
}
