import Link from "next/link";
import { AlertCircle, Truck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDeliveryOverviewForHousehold } from "@/lib/picnic/deliveryStatus";
import { formatSlotWindow, type DeliveryDayGroup } from "@/lib/picnic/deliverySlots";
import { DAY_KEY_BY_ENUM, DAY_LABELS } from "@/lib/week";
import DeliverySlotsRefreshButton from "./DeliverySlotsRefreshButton";

/** Hoeveel dagen meteen zichtbaar zijn; de rest staat achter "verder vooruit kijken". */
const DAYS_SHOWN_DIRECTLY = 3;

const CARD = "mb-4 min-w-0 rounded-xl border border-line bg-surface p-3 text-xs";

function formatClockTime(date: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function DayRow({ group, isPreferredDay }: { group: DeliveryDayGroup; isPreferredDay: boolean }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] items-start gap-2 border-t border-line py-1.5 first:border-t-0 first:pt-0">
      <span className={`pt-0.5 ${isPreferredDay ? "font-semibold text-ink" : "text-ink-muted"}`}>{group.label}</span>
      <span className="flex flex-wrap gap-1">
        {group.availableSlots.length > 0 ? (
          group.availableSlots.map((slot) => (
            <span
              key={slot.id}
              className="rounded-full bg-tag-green-bg px-2 py-0.5 text-tag-green-ink tabular-nums"
            >
              {formatSlotWindow(slot)}
            </span>
          ))
        ) : (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-ink-faint">alles vol</span>
        )}
        {isPreferredDay && (
          <span className="rounded-full border border-dashed border-line px-2 py-0.5 text-ink-faint">
            jullie voorkeur
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Toont wanneer er bij Picnic nog bezorgd kan worden: alle dagen die Picnic
 * teruggeeft, niet alleen het ingestelde voorkeursmoment.
 *
 * Bewust geen vast aantal dagen ingebouwd — hoever Picnic vooruit kijkt is
 * hun rollende venster, dus we tonen precies wat binnenkomt en klappen alles
 * voorbij de eerste paar dagen in.
 *
 * De gegevens zijn per definitie een momentopname: daarom staat het tijdstip
 * van ophalen erbij, met een knop om opnieuw op te halen. Picnic legt een
 * tijdvak pas vast wanneer de gebruiker het in de Picnic-app zelf kiest —
 * dat zegt de kaart er expliciet bij, zodat "beschikbaar" niet als reservering
 * gelezen wordt.
 */
export default async function DeliverySlotsCard({
  householdId,
  picnicAuthToken,
}: {
  householdId: string;
  picnicAuthToken: string | null;
}) {
  const preference = await prisma.picnicDeliveryPreference.findUnique({ where: { householdId } });
  const preferenceLine = preference
    ? `Jullie voorkeur: ${DAY_LABELS[DAY_KEY_BY_ENUM[preference.preferredDayOfWeek]].toLowerCase()} rond ${preference.preferredTime}`
    : null;

  if (!picnicAuthToken) {
    return (
      <div className={CARD}>
        <p className="flex items-center gap-2 font-medium text-ink">
          <Truck size={16} />
          Bezorgen bij Picnic
        </p>
        <p className="mt-1 text-ink-muted">
          <Link href="/ons-gezin" className="underline">
            Koppel je Picnic-account
          </Link>{" "}
          om te zien wanneer er nog bezorgd kan worden.
        </p>
        {preferenceLine && <p className="mt-1 text-ink-faint">{preferenceLine}</p>}
      </div>
    );
  }

  const overview = await getDeliveryOverviewForHousehold({
    householdId,
    picnicAuthToken,
    preference,
  });

  const preferredDayKey = preference ? DAY_KEY_BY_ENUM[preference.preferredDayOfWeek] : null;
  const directDays = overview.groups.slice(0, DAYS_SHOWN_DIRECTLY);
  const laterDays = overview.groups.slice(DAYS_SHOWN_DIRECTLY);

  return (
    <div id="bezorgmomenten" className={`${CARD} scroll-mt-6`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium text-ink">
          <Truck size={16} />
          Bezorgen bij Picnic
        </p>
        <div className="flex items-center gap-2">
          {!overview.error && (
            <span className="text-[10px] text-ink-faint">opgehaald om {formatClockTime(overview.fetchedAt)}</span>
          )}
          <DeliverySlotsRefreshButton />
        </div>
      </div>

      {overview.error === "auth" && (
        <p className="mt-2 flex items-start gap-2 rounded-lg bg-tag-amber-bg px-2.5 py-2 text-tag-amber-ink">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>
            Je Picnic-sessie is verlopen, dus ik kan de bezorgmomenten nu niet ophalen.{" "}
            <Link href="/ons-gezin" className="underline">
              Koppel je account opnieuw
            </Link>
            .
          </span>
        </p>
      )}

      {overview.error === "other" && (
        <p className="mt-2 flex items-start gap-2 rounded-lg bg-tag-amber-bg px-2.5 py-2 text-tag-amber-ink">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>Picnic reageerde niet op de vraag naar bezorgmomenten. Probeer het zo nog eens.</span>
        </p>
      )}

      {!overview.error && overview.groups.length === 0 && (
        <p className="mt-2 text-ink-muted">Picnic geeft op dit moment geen bezorgmomenten terug.</p>
      )}

      {directDays.length > 0 && (
        <div className="mt-2">
          {directDays.map((group) => (
            <DayRow key={group.isoDate} group={group} isPreferredDay={group.dayKey === preferredDayKey} />
          ))}
        </div>
      )}

      {laterDays.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer py-1 font-medium text-accent">
            Verder vooruit kijken ({laterDays.length} {laterDays.length === 1 ? "dag" : "dagen"})
          </summary>
          <div className="mt-1">
            {laterDays.map((group) => (
              <DayRow key={group.isoDate} group={group} isPreferredDay={group.dayKey === preferredDayKey} />
            ))}
          </div>
        </details>
      )}

      {overview.preferred && overview.preferred.status !== "AVAILABLE" && (
        <p className="mt-2 text-ink-muted">{overview.preferred.message}</p>
      )}

      {!overview.error && overview.groups.length > 0 && (
        <p className="mt-2 text-[10px] leading-snug text-ink-faint">
          Picnic legt een tijdvak pas vast als je het in de Picnic-app zelf kiest.
        </p>
      )}
    </div>
  );
}
