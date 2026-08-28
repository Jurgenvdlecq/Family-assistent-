/**
 * ISO-8601-weeknummers en het oneven/even-ritme dat daarop leunt.
 *
 * Waarom ISO en niet "de hoeveelste maandag van het jaar": ISO legt vast dat
 * week 1 de week is die de eerste donderdag van het jaar bevat. Alleen daarmee
 * klopt de jaargrens — 29 december 2025 hoort bij week 1 van 2026, en
 * 1 januari 2027 hoort nog bij week 53 van 2026. Zonder die regel zou een
 * huishouden rond oud en nieuw ineens twee oneven weken achter elkaar krijgen.
 *
 * Alle functies lezen de **lokale** kalenderdatum (`getFullYear`/`getMonth`/
 * `getDate`), net als `getCurrentWeekStart` en `dateForDay` in `lib/week.ts`.
 * Dat is bewust: een `@db.Date` uit Prisma komt terug als middernacht UTC, en
 * Europe/Amsterdam loopt vóór op UTC, dus dat blijft dezelfde kalenderdag.
 * De rekenkern zet die drie getallen daarna om naar een UTC-datum, zodat
 * zomertijd nooit een dag kan verschuiven tijdens het optellen.
 */

export const WEEK_PARITIES = ["EVERY", "ODD", "EVEN"] as const;

/**
 * Op welke weken een regel van toepassing is. `EVERY` is de standaard en het
 * enige dat bestond vóór het weekritme — een huishouden dat niets instelt
 * gedraagt zich daardoor precies zoals altijd.
 */
export type WeekParity = (typeof WEEK_PARITIES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/** De kalenderdatum als UTC-middernacht, zodat dagen optellen nooit over zomertijd struikelt. */
function toUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

/** De donderdag van de ISO-week waar deze datum in valt — het anker van de hele norm. */
function isoThursdayOf(date: Date): Date {
  const day = toUtcDay(date);
  // getUTCDay: 0 = zondag. ISO telt maandag als 1 en zondag als 7.
  const isoDayNumber = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
  day.setUTCDate(day.getUTCDate() + 4 - isoDayNumber);
  return day;
}

/** Het jaar waar deze week volgens ISO bij hoort — kan afwijken van het kalenderjaar. */
export function isoWeekYear(date: Date): number {
  return isoThursdayOf(date).getUTCFullYear();
}

/** Het ISO-weeknummer (1 t/m 52 of 53). */
export function isoWeekNumber(date: Date): number {
  const thursday = isoThursdayOf(date);
  const firstDayOfIsoYear = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const daysSinceYearStart = (thursday.getTime() - firstDayOfIsoYear) / DAY_MS;
  return Math.floor(daysSinceYearStart / 7) + 1;
}

/** Valt deze datum in een oneven of een even ISO-week? */
export function weekParityForDate(date: Date): "ODD" | "EVEN" {
  return isoWeekNumber(date) % 2 === 1 ? "ODD" : "EVEN";
}

/**
 * Geldt een regel met deze pariteit op deze datum? `EVERY` altijd; de andere
 * twee alleen in hun eigen weeksoort.
 */
export function parityAppliesToDate(parity: WeekParity, date: Date): boolean {
  return parity === "EVERY" || parity === weekParityForDate(date);
}

export function isWeekParity(value: unknown): value is WeekParity {
  return typeof value === "string" && (WEEK_PARITIES as readonly string[]).includes(value);
}

/**
 * "2026-08-28" in lokale kalendertijd. Gebruikt om een opgeslagen
 * datum-uitzondering (`@db.Date`, dus middernacht UTC) te vergelijken met een
 * datum die de app zelf heeft uitgerekend — die twee zijn als `Date`-object
 * niet gelijk, maar als kalenderdag wel.
 */
export function calendarDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * De kalenderdag als middernacht **UTC** — de vorm die een `@db.Date`-kolom
 * verwacht.
 *
 * Waarom dit nodig is: Prisma zet een `Date` om naar UTC en bewaart daar het
 * datumdeel van. Een datum die als lokale middernacht is uitgerekend, is in
 * Europe/Amsterdam 22:00 of 23:00 UTC op de dág ervoor — en dan komt er een
 * dag te vroeg in de database te staan. Aangetoond met een test tegen de
 * echte database met `TZ=Europe/Amsterdam`: 11 september werd 10 september,
 * waarna de uitzondering nooit meer werd teruggevonden.
 *
 * Valt niet op zolang de server in UTC draait (zoals Vercel), maar wel zodra
 * iemand de app lokaal draait — of zodra die instelling ooit verandert.
 */
export function toCalendarDate(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

/**
 * De kalenderdag van een waarde die uít een `@db.Date`-kolom komt.
 *
 * Zulke waarden zijn altijd middernacht UTC, dus die moeten ook met
 * UTC-ogen gelezen worden. `calendarDateKey` gebruikt lokale getters en is
 * bedoeld voor datums die de app zélf heeft uitgerekend; die twee door
 * elkaar halen levert in een tijdzone áchter UTC een dag verschil op — en
 * dan wordt een opgeslagen uitzondering nooit meer teruggevonden.
 */
export function calendarDateKeyFromColumn(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}
