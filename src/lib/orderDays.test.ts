import { test } from "node:test";
import assert from "node:assert/strict";
import { getOrderDayWindow, isSelectableOrderDate, nextDateForWeekday, parseOrderDate } from "./orderDays";

// Woensdag 2 september 2026.
const WEDNESDAY = new Date("2026-09-02T10:00:00");

test("getOrderDayWindow: begint bij het eerste bezorgmoment, niet bij vandaag", () => {
  // Bezorging pas vrijdag: donderdag koken kan niet met deze boodschappen.
  const days = getOrderDayWindow({ now: WEDNESDAY, firstDeliveryDate: parseOrderDate("2026-09-04") });

  assert.equal(days[0].isoDate, "2026-09-04");
  assert.equal(days[0].dayKey, "friday");
  assert.equal(days.length, 7);
});

test("getOrderDayWindow: zonder bekend bezorgmoment begint het venster vandaag", () => {
  const days = getOrderDayWindow({ now: WEDNESDAY, firstDeliveryDate: null });

  assert.equal(days[0].isoDate, "2026-09-02");
  assert.equal(days[0].dayKey, "wednesday");
});

test("getOrderDayWindow: een bezorgmoment in het verleden schuift het venster niet terug", () => {
  const days = getOrderDayWindow({ now: WEDNESDAY, firstDeliveryDate: parseOrderDate("2026-08-30") });

  assert.equal(days[0].isoDate, "2026-09-02", "nooit dagen aanbieden die al voorbij zijn");
});

test("getOrderDayWindow: markeert dagen die over de weekgrens vallen", () => {
  // Week van maandag 31 aug t/m zondag 6 sep; alles daarna is volgende week.
  const days = getOrderDayWindow({ now: WEDNESDAY, firstDeliveryDate: parseOrderDate("2026-09-04") });

  const byDate = Object.fromEntries(days.map((day) => [day.isoDate, day]));
  assert.equal(byDate["2026-09-06"].isNextWeek, false, "zondag 6 sep hoort nog bij deze week");
  assert.equal(byDate["2026-09-07"].isNextWeek, true, "maandag 7 sep is de volgende week");
  assert.equal(byDate["2026-09-07"].weekStart.getTime(), new Date("2026-09-07T00:00:00").getTime());
});

test("getOrderDayWindow: stopt bij het einde van de volgende week i.p.v. iets te beloven wat de lijst niet meeneemt", () => {
  // Vanaf vandaag kan het venster nooit over die grens lopen (hooguit tot
  // zaterdag van de volgende week). Alleen een láát bezorgmoment duwt 'm
  // eroverheen: bezorging pas woensdag 9 september, dus het venster zou tot
  // 15 september lopen — maar de lijstopbouw dekt alleen deze en de volgende
  // week, dus t/m zondag 13 september.
  const days = getOrderDayWindow({ now: WEDNESDAY, firstDeliveryDate: parseOrderDate("2026-09-09") });

  assert.deepEqual(
    days.map((day) => day.isoDate),
    ["2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"]
  );
  assert.ok(
    days.every((day) => day.isNextWeek),
    "deze hele reeks valt in de volgende week"
  );
});

test("getOrderDayWindow: een venster dat vandaag begint valt altijd binnen bereik", () => {
  // Elke dag van de week nalopen — dit is precies de grens waar een
  // afrondfout een dag zou laten verdwijnen die de gebruiker wél mag kiezen.
  for (let offset = 0; offset < 7; offset += 1) {
    const now = new Date("2026-08-31T10:00:00");
    now.setDate(now.getDate() + offset);
    const days = getOrderDayWindow({ now, firstDeliveryDate: null });
    assert.equal(days.length, 7, `venster vanaf dag ${offset} moet volledig zijn`);
  }
});

test("getOrderDayWindow: labels zijn leesbaar en kloppen met de dag", () => {
  const days = getOrderDayWindow({ now: WEDNESDAY, firstDeliveryDate: parseOrderDate("2026-09-04") });
  assert.equal(days[0].shortLabel, "VR");
  assert.equal(days[0].fullLabel, "Vrijdag 4 sep");
  assert.equal(days[0].dayNumber, 4);
});

test("parseOrderDate: leest een kalenderdag, ook rond een tijdzone-offset", () => {
  const parsed = parseOrderDate("2026-09-04");
  assert.equal(parsed?.getFullYear(), 2026);
  assert.equal(parsed?.getMonth(), 8);
  assert.equal(parsed?.getDate(), 4, "mag niet naar de vorige dag verschuiven");
  assert.equal(parsed?.getHours(), 0);
});

test("parseOrderDate: onzin geeft null i.p.v. een ongeldige datum", () => {
  assert.equal(parseOrderDate("gisteren"), null);
  assert.equal(parseOrderDate("2026-13-45"), null);
  assert.equal(parseOrderDate(""), null);
});

test("isSelectableOrderDate: accepteert vandaag t/m het einde van de volgende week", () => {
  assert.equal(isSelectableOrderDate(new Date("2026-09-02T00:00:00"), WEDNESDAY), true, "vandaag mag");
  assert.equal(isSelectableOrderDate(new Date("2026-09-13T00:00:00"), WEDNESDAY), true, "laatste dag volgende week mag");
});

test("isSelectableOrderDate: weigert het verleden en alles voorbij de volgende week", () => {
  assert.equal(isSelectableOrderDate(new Date("2026-09-01T00:00:00"), WEDNESDAY), false, "gisteren mag niet");
  assert.equal(
    isSelectableOrderDate(new Date("2026-09-14T00:00:00"), WEDNESDAY),
    false,
    "voorbij de volgende week kan de lijstopbouw niet waarmaken"
  );
});

test("nextDateForWeekday: de eerstvolgende bezorgdag volgens de eigen voorkeur", () => {
  // Woensdag 2 september 2026.
  assert.equal(nextDateForWeekday("friday", WEDNESDAY).getDate(), 4, "vrijdag deze week");
  assert.equal(nextDateForWeekday("tuesday", WEDNESDAY).getDate(), 8, "dinsdag is pas volgende week");
  assert.equal(nextDateForWeekday("wednesday", WEDNESDAY).getDate(), 2, "vandaag telt mee als het die dag is");
});

test("isSelectableOrderDate: weghalen mag ook voor een avond die al geweest is deze week", () => {
  // Na de migratie kunnen dagen eerder deze week op "telt mee" staan. Die
  // moet de gebruiker er altijd weer af kunnen halen — toevoegen blijft wel
  // beperkt tot vandaag en later.
  const monday = new Date("2026-08-31T00:00:00");
  assert.equal(isSelectableOrderDate(monday, WEDNESDAY, "remove"), true);
  assert.equal(isSelectableOrderDate(monday, WEDNESDAY, "add"), false);
});

test("isSelectableOrderDate: weghalen blijft begrensd tot deze en de volgende week", () => {
  assert.equal(isSelectableOrderDate(new Date("2026-08-30T00:00:00"), WEDNESDAY, "remove"), false, "vorige week");
  assert.equal(isSelectableOrderDate(new Date("2026-09-14T00:00:00"), WEDNESDAY, "remove"), false, "te ver vooruit");
});
