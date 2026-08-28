import { DAY_KEYS, DAY_LABELS, DAY_SHORT_LABELS, formatDayShort, getCurrentWeekStart, type DayKey } from "./week";

/** Hoeveel avonden de dagkeuze standaard aanbiedt vanaf het bezorgmoment. */
export const ORDER_DAY_WINDOW_DAYS = 7;

export type OrderDay = {
  /** yyyy-mm-dd — de sleutel die de server-actie terugkrijgt uit het formulier. */
  isoDate: string;
  dayKey: DayKey;
  /** Maandag van de week waarin deze dag valt — bepaalt in welk weekplan de avond staat. */
  weekStart: Date;
  /** Valt deze dag buiten de huidige week? De UI markeert dat, want het is niet vanzelfsprekend. */
  isNextWeek: boolean;
  /** "DO" */
  shortLabel: string;
  /** "Donderdag 4 sep" */
  fullLabel: string;
  dayNumber: number;
};

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Leest een yyyy-mm-dd-datum als kalenderdag. Bewust op 12:00 uur ingelezen
 * en daarna teruggezet naar middernacht: bij een tijdzone-offset zou
 * middernacht zomaar op de vorige dag kunnen uitkomen.
 */
export function parseOrderDate(isoDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const parsed = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return startOfDay(parsed);
}

/**
 * De laatste dag die de app waar kan maken. De boodschappenlijst hangt aan
 * het weekplan van déze week en mag daarnaast alleen avonden uit de volgende
 * week meenemen (zie `getGroceryMealEntries`) — verder vooruit aanbieden zou
 * een belofte zijn die de lijst niet nakomt.
 */
function lastSelectableDate(now: Date): Date {
  const last = getCurrentWeekStart(now);
  last.setDate(last.getDate() + 13);
  return last;
}

/** Welke dag van de week is dit? (maandag = eerste, net als DAY_KEYS.) */
export function dayKeyForDate(date: Date): DayKey {
  return DAY_KEYS[(date.getDay() + 6) % 7];
}

function toOrderDay(date: Date, currentWeekStart: Date): OrderDay {
  const dayKey = dayKeyForDate(date);
  const weekStart = getCurrentWeekStart(date);
  return {
    isoDate: toIsoDate(date),
    dayKey,
    weekStart,
    isNextWeek: weekStart.getTime() > currentWeekStart.getTime(),
    shortLabel: DAY_SHORT_LABELS[dayKey],
    fullLabel: `${DAY_LABELS[dayKey]} ${formatDayShort(date)}`,
    dayNumber: date.getDate(),
  };
}

/**
 * De avonden waarvoor de gebruiker boodschappen kan meenemen in de
 * eerstvolgende bestelling.
 *
 * Begint bij het eerste bezorgmoment dat Picnic nog aanbiedt, niet bij
 * vandaag: koken op een avond vóór de bezorging kan nu eenmaal niet met
 * boodschappen die dan nog niet geleverd zijn. Is er geen bezorgmoment
 * bekend (geen koppeling, of Picnic onbereikbaar), dan begint het venster
 * gewoon vandaag — beter een bruikbare keuze dan geen keuze.
 */
export function getOrderDayWindow(input: {
  now: Date;
  firstDeliveryIsoDate?: string | null;
  windowDays?: number;
}): OrderDay[] {
  const windowDays = input.windowDays ?? ORDER_DAY_WINDOW_DAYS;
  const today = startOfDay(input.now);
  const currentWeekStart = getCurrentWeekStart(input.now);
  const last = lastSelectableDate(input.now);

  const delivery = input.firstDeliveryIsoDate ? parseOrderDate(input.firstDeliveryIsoDate) : null;
  const start = delivery && delivery.getTime() > today.getTime() ? delivery : today;

  const days: OrderDay[] = [];
  for (let offset = 0; offset < windowDays; offset += 1) {
    const date = new Date(start);
    date.setDate(date.getDate() + offset);
    if (date.getTime() > last.getTime()) break;
    days.push(toOrderDay(date, currentWeekStart));
  }
  return days;
}

/**
 * Mag deze datum überhaupt aan- of uitgezet worden? Bewust losgekoppeld van
 * `getOrderDayWindow`: het venster bepaalt wat de app *toont*, deze controle
 * bepaalt wat de server *accepteert*. Een verlopen tabblad of een
 * gemanipuleerd formulier mag nooit een avond ver in de toekomst aanzetten
 * die de lijstopbouw daarna niet meeneemt.
 */
export function isSelectableOrderDate(date: Date, now: Date): boolean {
  const day = startOfDay(date);
  return day.getTime() >= startOfDay(now).getTime() && day.getTime() <= lastSelectableDate(now).getTime();
}
