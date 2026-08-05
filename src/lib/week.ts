export type DayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export const DAY_KEYS: DayKey[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export const DAY_ENUM: Record<
  DayKey,
  "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY"
> = {
  monday: "MONDAY",
  tuesday: "TUESDAY",
  wednesday: "WEDNESDAY",
  thursday: "THURSDAY",
  friday: "FRIDAY",
  saturday: "SATURDAY",
  sunday: "SUNDAY",
};

export const DAY_KEY_BY_ENUM = Object.fromEntries(
  DAY_KEYS.map((dayKey) => [DAY_ENUM[dayKey], dayKey])
) as Record<(typeof DAY_ENUM)[DayKey], DayKey>;

export const DAY_LABELS: Record<DayKey, string> = {
  monday: "Maandag",
  tuesday: "Dinsdag",
  wednesday: "Woensdag",
  thursday: "Donderdag",
  friday: "Vrijdag",
  saturday: "Zaterdag",
  sunday: "Zondag",
};

export const DAY_SHORT_LABELS: Record<DayKey, string> = {
  monday: "MA",
  tuesday: "DI",
  wednesday: "WO",
  thursday: "DO",
  friday: "VR",
  saturday: "ZA",
  sunday: "ZO",
};

/** Maandag 00:00 van de huidige week. */
export function getCurrentWeekStart(reference: Date = new Date()): Date {
  const d = new Date(reference);
  const day = d.getDay(); // 0 = zondag
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function dateForDay(weekStart: Date, dayKey: DayKey): Date {
  const idx = DAY_KEYS.indexOf(dayKey);
  const d = new Date(weekStart);
  d.setDate(d.getDate() + idx);
  return d;
}

const SHORT_MONTHS = [
  "jan",
  "feb",
  "mrt",
  "apr",
  "mei",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
];

export function formatDayShort(date: Date): string {
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`;
}

/** Bijvoorbeeld "12 - 18 mei". */
export function formatWeekRange(weekStart: Date): string {
  const end = dateForDay(weekStart, "sunday");
  const sameMonth = weekStart.getMonth() === end.getMonth();
  const startLabel = sameMonth
    ? `${weekStart.getDate()}`
    : `${weekStart.getDate()} ${SHORT_MONTHS[weekStart.getMonth()]}`;
  return `${startLabel} - ${formatDayShort(end)}`;
}

// Zelfde vaste Europe/Amsterdam-tijdzone als notificationPolicy.ts (v1 is
// NL/BE-only) — gebruikt voor de twee functies hieronder, die allebei om
// "hoe laat/welke dag is het écht" gaan, niet om serverlokale tijd.
const DISPLAY_TIME_ZONE = "Europe/Amsterdam";

/** "Goedemorgen"/"Goedemiddag"/"Goedenavond" op basis van het huidige uur — was voorheen altijd "Goedemorgen", ook 's avonds. */
export function timeOfDayGreeting(now: Date = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: DISPLAY_TIME_ZONE, hour: "2-digit", hour12: false }).format(now)
  );
  if (hour < 12) return "Goedemorgen";
  if (hour < 18) return "Goedemiddag";
  return "Goedenavond";
}

function calendarDayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

/** Is deze dag al begonnen (vandaag of eerder)? Voorkomt dat de app om feedback vraagt over een maaltijd die nog gegeten moet worden. */
export function isDayStartedOrPast(date: Date, now: Date = new Date()): boolean {
  return calendarDayKey(date) <= calendarDayKey(now);
}

const WEEKDAY_TO_DAY_KEY: Record<string, DayKey> = {
  Mon: "monday",
  Tue: "tuesday",
  Wed: "wednesday",
  Thu: "thursday",
  Fri: "friday",
  Sat: "saturday",
  Sun: "sunday",
};

/**
 * DayKey van vandaag in Europe/Amsterdam — voor een standaardwaarde als een
 * dag niet expliciet is meegegeven (bv. `/gerechten` zonder `?day=`,
 * rechtstreeks via de navbar). Was voorheen alleen op de startpagina
 * uitgerekend (voor het "toch ergens anders zin in?"-daginvulveld) via
 * serverlokale tijd (`getDay()`), en stond op `/gerechten` zelf hardcoded op
 * "monday" — nu één plek, en expliciet Amsterdam-tijd i.p.v. serverlokale
 * tijd (die op deze sandbox/Vercel UTC is): anders geeft dit vlak na
 * middernacht lokale tijd nog de vorige dag terug, precies de bug die deze
 * functie moet oplossen.
 */
export function currentDayKey(now: Date = new Date()): DayKey {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIME_ZONE, weekday: "short" }).format(now);
  return WEEKDAY_TO_DAY_KEY[weekday] ?? "monday";
}
