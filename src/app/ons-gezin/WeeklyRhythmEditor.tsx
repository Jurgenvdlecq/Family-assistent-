"use client";

import { useState, useTransition } from "react";
import { DAY_KEYS, DAY_SHORT_LABELS, type DayKey } from "@/lib/week";
import { updateWeeklyRhythm } from "./actions";

export default function WeeklyRhythmEditor({
  householdId,
  initialRhythm,
}: {
  householdId: string;
  initialRhythm: Partial<Record<DayKey, "busy" | "quiet">>;
}) {
  const [rhythm, setRhythm] = useState(initialRhythm);
  const [isPending, startTransition] = useTransition();

  function setDay(dayKey: DayKey, value: "busy" | "quiet") {
    setRhythm((prev) => ({ ...prev, [dayKey]: value }));
    const formData = new FormData();
    formData.set("householdId", householdId);
    formData.set("dayKey", dayKey);
    formData.set("value", value);
    startTransition(() => updateWeeklyRhythm(formData));
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {DAY_KEYS.map((dayKey) => (
        <div key={dayKey} className="flex min-w-0 items-center justify-between">
          <span className="text-sm font-medium text-ink">{DAY_SHORT_LABELS[dayKey]}</span>
          <div className="flex shrink-0 gap-1 rounded-lg bg-surface-2 p-1">
            {(["quiet", "busy"] as const).map((value) => (
              <button
                key={value}
                type="button"
                disabled={isPending}
                onClick={() => setDay(dayKey, value)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
                  (rhythm[dayKey] ?? "quiet") === value
                    ? "bg-accent text-accent-ink"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {value === "busy" ? "Druk" : "Rustig"}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
