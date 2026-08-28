"use client";

import { useFormStatus } from "react-dom";

/**
 * De dagtegel in de dagkeuze.
 *
 * Bewust een eigen knop en niet `PendingSubmitButton`: die vervangt zijn
 * label door "Bezig...", en dat past niet in een tegel van twee tekens.
 * Hier blijft de dag staan en verspringt de tegel meteen naar de toestand
 * die je aantikt. Zonder dat gebeurde er na een tik seconden lang zichtbaar
 * niets — de server was allang klaar, maar het scherm zei niets.
 */
export default function DayToggleButton({
  included,
  shortLabel,
  dayNumber,
  fullLabel,
  isoDate,
  isNextWeek,
}: {
  included: boolean;
  shortLabel: string;
  dayNumber: number;
  fullLabel: string;
  isoDate: string;
  isNextWeek: boolean;
}) {
  const { pending } = useFormStatus();
  // Tijdens het versturen alvast de toestand tonen die je hebt aangetikt.
  const showsAsIncluded = pending ? !included : included;

  const base =
    "flex min-w-[2.75rem] flex-col items-center gap-0.5 rounded-lg border px-2 py-1.5 text-center transition-all duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  const tone = showsAsIncluded
    ? "border-accent bg-accent text-accent-ink"
    : "border-line bg-surface text-ink hover:bg-surface-2";
  const nextWeek = isNextWeek && !showsAsIncluded ? "border-dashed" : "";
  const busy = pending ? "opacity-70" : "";

  return (
    <button
      type="submit"
      aria-label={`${fullLabel}: ${included ? "niet meenemen in deze bestelling" : "boodschappen meenemen"}`}
      aria-pressed={included}
      aria-busy={pending}
      // Het onderscheid "deze week / volgende week" is niet af te leiden uit
      // de zichtbare tekst (alleen uit een stippellijn), maar de e2e-test
      // moet er wel gericht op kunnen selecteren.
      data-order-day={isoDate}
      data-next-week={isNextWeek ? "true" : "false"}
      className={`${base} ${tone} ${nextWeek} ${busy}`}
    >
      <span className={`text-[10px] ${showsAsIncluded ? "text-accent-ink" : "text-ink-muted"}`}>{shortLabel}</span>
      <span className="text-xs font-semibold tabular-nums">{dayNumber}</span>
    </button>
  );
}
