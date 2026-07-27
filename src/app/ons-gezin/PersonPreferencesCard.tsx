"use client";

import { Save } from "lucide-react";
import { DAY_ENUM, DAY_KEYS, DAY_SHORT_LABELS, type DayKey } from "@/lib/week";
import { updatePersonPresence, updatePersonProfile } from "./actions";

const ROLE_OPTIONS = [
  { value: "PARENT", label: "Ouder" },
  { value: "CHILD", label: "Kind" },
  { value: "OTHER", label: "Anders" },
] as const;

const AVATAR_TONES = [
  "bg-tag-blue-bg text-tag-blue-ink",
  "bg-tag-green-bg text-tag-green-ink",
  "bg-tag-amber-bg text-tag-amber-ink",
  "bg-tag-purple-bg text-tag-purple-ink",
  "bg-tag-pink-bg text-tag-pink-ink",
];

type PersonCardData = {
  id: string;
  name: string;
  role: "PARENT" | "CHILD" | "OTHER";
  hardRestrictions: string[];
  defaultPresent: boolean;
  portionMultiplier: number;
  presenceOverrides: { dayOfWeek: (typeof DAY_ENUM)[DayKey]; present: boolean }[];
};

function avatarTone(name: string) {
  const sum = [...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_TONES[sum % AVATAR_TONES.length];
}

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase();
}

function isPresent(person: PersonCardData, dayKey: DayKey) {
  return person.presenceOverrides.find((override) => override.dayOfWeek === DAY_ENUM[dayKey])?.present ?? person.defaultPresent;
}

export default function PersonPreferencesCard({
  householdId,
  person,
}: {
  householdId: string;
  person: PersonCardData;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface p-4">
      <div className="mb-4 flex min-w-0 items-center gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarTone(person.name)}`}
        >
          {initials(person.name)}
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{person.name}</p>
          <p className="text-xs text-ink-faint">
            {person.defaultPresent ? "Eet meestal mee" : "Eet niet standaard mee"}
          </p>
        </div>
      </div>

      <form action={updatePersonProfile} className="grid min-w-0 gap-3">
        <input type="hidden" name="householdId" value={householdId} />
        <input type="hidden" name="personId" value={person.id} />

        <div className="grid grid-cols-2 gap-2">
          <label className="min-w-0 text-xs font-medium text-ink-muted">
            Rol
            <select
              name="role"
              defaultValue={person.role}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>

          <label className="min-w-0 text-xs font-medium text-ink-muted">
            Portie
            <input
              type="number"
              name="portionMultiplier"
              defaultValue={person.portionMultiplier}
              min="0.25"
              max="4"
              step="0.05"
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="defaultPresent"
            defaultChecked={person.defaultPresent}
            className="h-4 w-4 rounded border-line text-accent"
          />
          Eet standaard mee
        </label>

        <label className="min-w-0 text-xs font-medium text-ink-muted">
          Harde beperkingen
          <input
            type="text"
            name="hardRestrictions"
            defaultValue={person.hardRestrictions.join(", ")}
            placeholder="bijv. pinda, lactose, varken"
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
        </label>

        <button
          type="submit"
          title="Profiel opslaan"
          className="inline-flex w-fit items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-ink"
        >
          <Save size={14} />
          Opslaan
        </button>
      </form>

      <div className="mt-4 border-t border-line pt-3">
        <p className="mb-2 text-xs font-medium text-ink-muted">Mee-eten per dag</p>
        <div className="grid grid-cols-7 gap-1.5">
          {DAY_KEYS.map((dayKey) => {
            const present = isPresent(person, dayKey);
            return (
              <form key={dayKey} action={updatePersonPresence}>
                <input type="hidden" name="householdId" value={householdId} />
                <input type="hidden" name="personId" value={person.id} />
                <input type="hidden" name="dayKey" value={dayKey} />
                <input type="hidden" name="present" value={present ? "false" : "true"} />
                <button
                  type="submit"
                  title={`${DAY_SHORT_LABELS[dayKey]} ${present ? "uitzetten" : "aanzetten"}`}
                  className={`h-8 w-full rounded-lg border text-[11px] font-semibold ${
                    present
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line bg-surface text-ink-faint"
                  }`}
                >
                  {DAY_SHORT_LABELS[dayKey]}
                </button>
              </form>
            );
          })}
        </div>
      </div>
    </div>
  );
}
