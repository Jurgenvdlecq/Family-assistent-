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

export const DAY_LABELS: Record<DayKey, string> = {
  monday: "Maandag",
  tuesday: "Dinsdag",
  wednesday: "Woensdag",
  thursday: "Donderdag",
  friday: "Vrijdag",
  saturday: "Zaterdag",
  sunday: "Zondag",
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
