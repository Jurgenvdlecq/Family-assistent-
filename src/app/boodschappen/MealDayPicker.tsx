import Link from "next/link";
import { Utensils } from "lucide-react";
import type { OrderDay } from "@/lib/orderDays";
import { setMealIncludedInGroceries } from "./mealDayActions";

export type MealDayOption = OrderDay & {
  /** Telt deze avond mee in de eerstvolgende bestelling? */
  included: boolean;
  /** Huishouden eet deze avond niet thuis — dan valt er niets te winkelen. */
  skipped: boolean;
  /** Het geplande gerecht. Ontbreekt zolang de volgende week nog niet gepland is. */
  mealName?: string;
  /** Waarom de app dit gerecht voorstelde. */
  reason?: string;
};

function DayButton({ day }: { day: MealDayOption }) {
  const base =
    "flex min-w-[2.75rem] flex-col items-center gap-0.5 rounded-lg border px-2 py-1.5 text-center transition-colors";
  const tone = day.included
    ? "border-accent bg-accent text-accent-ink"
    : "border-line bg-surface text-ink hover:bg-surface-2";
  // Gestippeld = volgende week. Bewust zichtbaar: "dinsdag" na een bezorging
  // op zaterdag is een andere dinsdag dan de gebruiker misschien denkt.
  const nextWeek = day.isNextWeek && !day.included ? "border-dashed" : "";

  return (
    <form action={setMealIncludedInGroceries}>
      <input type="hidden" name="date" value={day.isoDate} />
      <input type="hidden" name="included" value={day.included ? "false" : "true"} />
      <button
        type="submit"
        aria-label={`${day.fullLabel}: ${day.included ? "niet meenemen in deze bestelling" : "boodschappen meenemen"}`}
        aria-pressed={day.included}
        // Het onderscheid "deze week / volgende week" is niet af te leiden uit
        // de zichtbare tekst (alleen uit een stippellijn), maar de e2e-test
        // moet er wel gericht op kunnen selecteren.
        data-order-day={day.isoDate}
        data-next-week={day.isNextWeek ? "true" : "false"}
        className={`${base} ${tone} ${nextWeek}`}
      >
        <span className={`text-[10px] ${day.included ? "text-accent-ink" : "text-ink-muted"}`}>{day.shortLabel}</span>
        <span className="text-xs font-semibold tabular-nums">{day.dayNumber}</span>
      </button>
    </form>
  );
}

/**
 * "Kook je zelf op een van deze dagen?" — de kern van de koerswijziging
 * "boodschappen eerst": vaste boodschappen staan altijd klaar, en avondeten
 * is opt-in per avond.
 *
 * De reeks begint bij het verwachte bezorgmoment (zie `getOrderDayWindow`),
 * want koken vóór de bezorging kan niet met deze boodschappen. Dagen in de
 * volgende week doen gewoon mee.
 */
export default function MealDayPicker({ days }: { days: MealDayOption[] }) {
  if (days.length === 0) return null;

  const chosen = days.filter((day) => day.included);

  return (
    <div id="avondeten" className="mb-6 min-w-0 scroll-mt-6 rounded-xl border border-line bg-surface p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
        <Utensils size={15} className="text-ink-muted" />
        Kook je zelf?
      </h2>
      <p className="mb-3 text-xs text-ink-muted">
        Tik de avonden aan waarvoor ik boodschappen meeneem. De rest van je lijst blijft gewoon staan.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {days.map((day) => (
          <DayButton key={day.isoDate} day={day} />
        ))}
      </div>

      {days.some((day) => day.isNextWeek) && (
        <p className="mt-2 text-[10px] leading-snug text-ink-faint">Gestippeld: dat is volgende week.</p>
      )}

      {chosen.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {chosen.map((day) => (
            <div key={day.isoDate} className="rounded-lg border border-line bg-bg p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wide text-ink-faint">{day.fullLabel}</span>
                <Link
                  href={`/gerechten?day=${day.dayKey}&direction=day${day.isNextWeek ? "&week=next" : ""}`}
                  className="rounded-md border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-ink hover:bg-surface-2"
                >
                  Wissel
                </Link>
              </div>

              {day.skipped ? (
                <p className="mt-1 text-xs text-tag-amber-ink">
                  Deze avond staat op &ldquo;uit eten&rdquo;, dus er komen geen boodschappen voor op de lijst.
                </p>
              ) : day.mealName ? (
                <>
                  <p className="mt-1 text-sm font-medium leading-snug text-ink">{day.mealName}</p>
                  {day.reason && <p className="mt-0.5 text-xs text-ink-muted">{day.reason}</p>}
                </>
              ) : (
                <p className="mt-1 text-xs text-ink-muted">Ik zoek er nog een gerecht bij.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
