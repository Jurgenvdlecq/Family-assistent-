import { Trash2 } from "lucide-react";
import { CATEGORY_LABELS } from "@/lib/categoryStyle";
import { deletePersonalPreference, updatePersonalPreference } from "./actions";

const STANCE_LABELS: Record<string, string> = {
  LIKED: "Favoriet",
  SOMETIMES: "Oké",
  RATHER_NOT: "Liever niet",
  NEVER: "Nooit",
  UNKNOWN: "Onbekend",
};

const SUBJECT_LABELS: Record<string, string> = {
  RECIPE_VARIANT: "Gerecht",
  RECIPE_CATEGORY: "Categorie",
  INGREDIENT: "Ingrediënt",
};

type PersonalPreferenceItem = {
  id: string;
  personId: string;
  personName: string;
  subjectType: string;
  subjectId: string;
  subjectLabel: string;
  stance: string;
};

type PersonGroup = {
  personId: string;
  personName: string;
  preferences: PersonalPreferenceItem[];
};

function groupByPerson(preferences: PersonalPreferenceItem[]): PersonGroup[] {
  const groups = new Map<string, PersonGroup>();
  for (const preference of preferences) {
    const group = groups.get(preference.personId) ?? {
      personId: preference.personId,
      personName: preference.personName,
      preferences: [],
    };
    group.preferences.push(preference);
    groups.set(preference.personId, group);
  }
  return Array.from(groups.values()).sort((a, b) => a.personName.localeCompare(b.personName));
}

export default function PersonalPreferencesManager({
  householdId,
  preferences,
}: {
  householdId: string;
  preferences: PersonalPreferenceItem[];
}) {
  const groups = groupByPerson(preferences);

  return (
    <details className="mb-8 min-w-0 rounded-xl border border-line bg-surface p-4">
      <summary className="cursor-pointer font-medium text-ink">Persoonlijke voorkeuren beheren</summary>
      <div className="mt-4 flex min-w-0 flex-col gap-4">
        {groups.length === 0 && (
          <p className="text-sm text-ink-muted">
            Nog geen persoonlijke voorkeuren vastgelegd. Dit groeit via de weekplanning.
          </p>
        )}

        {groups.map((group) => (
          <section key={group.personId} className="min-w-0">
            <h3 className="mb-2 text-sm font-semibold text-ink">{group.personName}</h3>
            <div className="flex min-w-0 flex-col divide-y divide-line rounded-lg border border-line">
              {group.preferences.map((preference) => (
                <div key={preference.id} className="grid min-w-0 gap-2 p-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{preference.subjectLabel}</p>
                    <p className="text-xs text-ink-faint">
                      {SUBJECT_LABELS[preference.subjectType] ?? preference.subjectType}
                    </p>
                  </div>

                  <form action={updatePersonalPreference} className="flex min-w-0 gap-2">
                    <input type="hidden" name="householdId" value={householdId} />
                    <input type="hidden" name="preferenceId" value={preference.id} />
                    <select
                      name="stance"
                      defaultValue={preference.stance}
                      className="min-w-0 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink"
                    >
                      {Object.entries(STANCE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink"
                    >
                      Opslaan
                    </button>
                  </form>

                  <form action={deletePersonalPreference} className="sm:justify-self-end">
                    <input type="hidden" name="householdId" value={householdId} />
                    <input type="hidden" name="preferenceId" value={preference.id} />
                    <button
                      type="submit"
                      aria-label={`${preference.subjectLabel} verwijderen`}
                      title="Voorkeur verwijderen"
                      className="rounded-lg border border-line p-2 text-ink-faint hover:border-red-300 hover:text-red-700"
                    >
                      <Trash2 size={14} />
                    </button>
                  </form>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </details>
  );
}

export function labelPersonalPreferenceSubject(
  preference: { subjectType: string; subjectId: string },
  labels: {
    variants: Map<string, string>;
    ingredients: Map<string, string>;
  }
) {
  if (preference.subjectType === "RECIPE_VARIANT") {
    return labels.variants.get(preference.subjectId) ?? "Onbekend gerecht";
  }
  if (preference.subjectType === "RECIPE_CATEGORY") {
    return CATEGORY_LABELS[preference.subjectId] ?? preference.subjectId;
  }
  if (preference.subjectType === "INGREDIENT") {
    return labels.ingredients.get(preference.subjectId) ?? "Onbekend ingrediënt";
  }
  return preference.subjectId;
}
