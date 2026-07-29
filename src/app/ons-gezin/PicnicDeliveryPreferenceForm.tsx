import { DAY_KEYS, DAY_LABELS, DAY_KEY_BY_ENUM } from "@/lib/week";
import type { DayOfWeek } from "@/generated/prisma/enums";
import { updatePicnicDeliveryPreference, removePicnicDeliveryPreference } from "./picnicDeliveryActions";

export default function PicnicDeliveryPreferenceForm({
  householdId,
  preference,
  picnicConnected,
}: {
  householdId: string;
  preference: {
    preferredDayOfWeek: DayOfWeek;
    preferredTime: string;
    windowMinutes: number;
    reminderDaysBefore: number;
    notificationsEnabled: boolean;
  } | null;
  picnicConnected: boolean;
}) {
  const defaultDayKey = preference ? DAY_KEY_BY_ENUM[preference.preferredDayOfWeek] : "friday";

  return (
    <div className="min-w-0">
      {!picnicConnected && (
        <p className="mb-3 rounded-lg bg-surface-2 p-3 text-xs text-ink-muted">
          Koppel eerst je Picnic-account hierboven — daarna kan ik de bezorgmomenten echt
          controleren. Je voorkeur kun je alvast instellen.
        </p>
      )}
      <form action={updatePicnicDeliveryPreference} className="grid gap-3">
        <input type="hidden" name="householdId" value={householdId} />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm text-ink">
            <span className="mb-1 block text-xs text-ink-muted">Gewenste bezorgdag</span>
            <select
              name="dayKey"
              defaultValue={defaultDayKey}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            >
              {DAY_KEYS.map((dayKey) => (
                <option key={dayKey} value={dayKey}>
                  {DAY_LABELS[dayKey]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-ink">
            <span className="mb-1 block text-xs text-ink-muted">Voorkeurstijd</span>
            <input
              type="time"
              name="preferredTime"
              defaultValue={preference?.preferredTime ?? "18:00"}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm text-ink">
            <span className="mb-1 block text-xs text-ink-muted">Marge (minuten)</span>
            <input
              type="number"
              name="windowMinutes"
              min={0}
              max={240}
              step={15}
              defaultValue={preference?.windowMinutes ?? 60}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
          <label className="text-sm text-ink">
            <span className="mb-1 block text-xs text-ink-muted">Herinner dagen van tevoren</span>
            <input
              type="number"
              name="reminderDaysBefore"
              min={0}
              max={6}
              defaultValue={preference?.reminderDaysBefore ?? 2}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="notificationsEnabled"
            defaultChecked={preference?.notificationsEnabled ?? true}
            className="h-4 w-4 rounded border-line text-accent"
          />
          Meldingen voor bezorgmomenten aan
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:opacity-90"
          >
            Opslaan
          </button>
          {preference && (
            <button
              type="submit"
              formAction={removePicnicDeliveryPreference}
              className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-muted hover:bg-surface-2"
            >
              Voorkeur verwijderen
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
