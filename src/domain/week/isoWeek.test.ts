import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendarDateKey,
  calendarDateKeyFromColumn,
  toCalendarDate,
  isoWeekNumber,
  isoWeekYear,
  parityAppliesToDate,
  weekParityForDate,
} from "./isoWeek";

/** Lokale kalenderdatum, net zoals de rest van de app dates aanmaakt. */
function d(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

test("isoWeekNumber: week 1 is de week met de eerste donderdag van het jaar", () => {
  // 1 januari 2026 is een donderdag, dus die dag zit per definitie in week 1.
  assert.equal(isoWeekNumber(d("2026-01-01")), 1);
  assert.equal(isoWeekYear(d("2026-01-01")), 2026);
  // De maandag ervóór hoort bij dezelfde ISO-week, ook al is het nog 2025.
  assert.equal(isoWeekNumber(d("2025-12-29")), 1);
  assert.equal(isoWeekYear(d("2025-12-29")), 2026);
});

test("isoWeekNumber: de jaargrens de andere kant op — 1 januari kan nog week 53 zijn", () => {
  // 1 januari 2027 is een vrijdag; de donderdag van die week valt in 2026,
  // dus de hele week hoort nog bij 2026.
  assert.equal(isoWeekNumber(d("2027-01-01")), 53);
  assert.equal(isoWeekYear(d("2027-01-01")), 2026);
  assert.equal(isoWeekNumber(d("2027-01-04")), 1);
  assert.equal(isoWeekYear(d("2027-01-04")), 2027);
});

test("isoWeekNumber: elke dag van dezelfde week geeft hetzelfde nummer", () => {
  // Maandag 7 t/m zondag 13 september 2026.
  const week = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"];
  const numbers = new Set(week.map((iso) => isoWeekNumber(d(iso))));
  assert.equal(numbers.size, 1, "een ISO-week loopt van maandag t/m zondag");
  assert.equal([...numbers][0], 37);
});

test("weekParityForDate: week 37 is oneven, week 38 is even", () => {
  assert.equal(isoWeekNumber(d("2026-09-07")), 37);
  assert.equal(weekParityForDate(d("2026-09-07")), "ODD");
  assert.equal(isoWeekNumber(d("2026-09-14")), 38);
  assert.equal(weekParityForDate(d("2026-09-14")), "EVEN");
});

test("weekParityForDate: opeenvolgende weken wisselen elkaar af, ook over de jaargrens", () => {
  // Week 53 van 2026 (oneven) wordt gevolgd door week 1 van 2027 (oneven) —
  // een 53-weekjaar breekt het ritme, en dat is precies wat ISO voorschrijft.
  // Het gaat er hier om dat de app dat deterministisch doet, niet dat het
  // ritme nooit hapert.
  assert.equal(weekParityForDate(d("2026-12-28")), "ODD");
  assert.equal(weekParityForDate(d("2027-01-04")), "ODD");
  assert.equal(weekParityForDate(d("2027-01-11")), "EVEN");
});

test("parityAppliesToDate: EVERY geldt altijd, ODD/EVEN alleen in hun eigen week", () => {
  const oddWeekFriday = d("2026-09-11");
  const evenWeekFriday = d("2026-09-18");

  assert.equal(parityAppliesToDate("EVERY", oddWeekFriday), true);
  assert.equal(parityAppliesToDate("EVERY", evenWeekFriday), true);
  assert.equal(parityAppliesToDate("ODD", oddWeekFriday), true);
  assert.equal(parityAppliesToDate("ODD", evenWeekFriday), false);
  assert.equal(parityAppliesToDate("EVEN", evenWeekFriday), true);
  assert.equal(parityAppliesToDate("EVEN", oddWeekFriday), false);
});

test("isoWeekNumber: zomertijdgrens verschuift geen dag", () => {
  // In de nacht van 28 op 29 maart 2026 gaat de klok vooruit. Een dag
  // optellen in lokale tijd zou hier 23 uur zijn; de UTC-rekenkern niet.
  assert.equal(isoWeekNumber(d("2026-03-29")), 13);
  assert.equal(isoWeekNumber(d("2026-03-30")), 14);
  assert.equal(isoWeekNumber(d("2026-10-25")), 43);
  assert.equal(isoWeekNumber(d("2026-10-26")), 44);
});

test("calendarDateKey: lokale kalenderdag, met voorloopnullen", () => {
  assert.equal(calendarDateKey(d("2026-09-07")), "2026-09-07");
  assert.equal(calendarDateKey(d("2026-01-05")), "2026-01-05");
});

test("toCalendarDate: een datum voor een @db.Date-kolom is altijd middernacht UTC", () => {
  // Zonder dit zou een lokaal uitgerekende middernacht in Europe/Amsterdam
  // als 22:00 UTC op de dág ervoor worden opgeslagen — en dan staat er een
  // dag te vroeg in de database.
  const stored = toCalendarDate(d("2026-09-11"));
  assert.equal(stored.toISOString(), "2026-09-11T00:00:00.000Z");
});

test("calendarDateKeyFromColumn: leest een opgeslagen datum met UTC-ogen", () => {
  const stored = new Date("2026-09-11T00:00:00.000Z");
  assert.equal(calendarDateKeyFromColumn(stored), "2026-09-11");
});

test("toCalendarDate en calendarDateKeyFromColumn zijn elkaars tegenhanger", () => {
  for (const iso of ["2026-01-01", "2026-03-29", "2026-09-11", "2026-12-31"]) {
    assert.equal(calendarDateKeyFromColumn(toCalendarDate(d(iso))), iso);
  }
});
