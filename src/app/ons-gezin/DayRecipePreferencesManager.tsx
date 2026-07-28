import { CalendarDays, Trash2 } from "lucide-react";
import { accessibleRecipeWhere } from "@/lib/recipeScope";
import { DAY_KEYS, DAY_LABELS, type DayKey } from "@/lib/week";
import { prisma } from "@/lib/prisma";
import {
  DAY_RECIPE_PREFERENCE_STANCES,
  dayRecipePreferenceOwnerId,
  type DayRecipePreferenceStance,
} from "@/domain/meal-planning/dayRecipePreferences";
import { deleteDayRecipePreference, setDayRecipePreference } from "./actions";

const DAY_STANCE_LABELS: Record<DayRecipePreferenceStance, string> = {
  LIKED: "Vaak op deze dag",
  SOMETIMES: "Soms handig",
  RATHER_NOT: "Liever niet op deze dag",
};

const DAY_STANCE_SHORT_LABELS: Record<string, string> = {
  LIKED: "vaak",
  SOMETIMES: "soms",
  RATHER_NOT: "liever niet",
};

export default async function DayRecipePreferencesManager({ householdId }: { householdId: string }) {
  const dayOwnerIds = DAY_KEYS.map((dayKey) => dayRecipePreferenceOwnerId(householdId, dayKey));
  const [variants, preferences] = await Promise.all([
    prisma.recipeVariant.findMany({
      where: { recipe: accessibleRecipeWhere(householdId) },
      include: { recipe: true },
      orderBy: [{ recipe: { title: "asc" } }, { createdAt: "asc" }],
    }),
    prisma.preference.findMany({
      where: {
        ownerType: "HOUSEHOLD",
        ownerId: { in: dayOwnerIds },
        subjectType: "RECIPE_VARIANT",
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const variantById = new Map(variants.map((variant) => [variant.id, variant]));
  const preferencesByDay = new Map<DayKey, typeof preferences>();
  for (const dayKey of DAY_KEYS) {
    const ownerId = dayRecipePreferenceOwnerId(householdId, dayKey);
    preferencesByDay.set(
      dayKey,
      preferences.filter((preference) => preference.ownerId === ownerId)
    );
  }

  return (
    <section className="mb-8 min-w-0 rounded-xl border border-line bg-surface p-4">
      <div className="mb-4 flex min-w-0 items-start gap-3">
        <CalendarDays size={18} className="mt-0.5 shrink-0 text-tag-green-ink" />
        <div className="min-w-0">
          <p className="font-medium text-ink">Gerechten per dag</p>
          <p className="text-sm text-ink-muted">
            Zet hier de gerechten die bij jullie logisch zijn op een bepaalde dag. Die krijgen voorrang in de weekplanning en op de gerechtenpagina.
          </p>
        </div>
      </div>

      <div className="grid gap-3">
        {DAY_KEYS.map((dayKey) => {
          const dayPreferences = preferencesByDay.get(dayKey) ?? [];
          return (
            <details key={dayKey} className="rounded-lg border border-line p-3">
              <summary className="cursor-pointer text-sm font-medium text-ink">
                {DAY_LABELS[dayKey]}
                <span className="ml-2 text-xs font-normal text-ink-muted">
                  {dayPreferences.length === 0 ? "nog geen vaste opties" : `${dayPreferences.length} opties`}
                </span>
              </summary>

              <div className="mt-3 grid gap-3">
                <form action={setDayRecipePreference} className="grid gap-2">
                  <input type="hidden" name="householdId" value={householdId} />
                  <input type="hidden" name="dayKey" value={dayKey} />
                  <select
                    name="recipeVariantId"
                    required
                    className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  >
                    <option value="">Kies een gerecht</option>
                    {variants.map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {variant.recipe.title}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <select
                      name="stance"
                      defaultValue="LIKED"
                      className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                    >
                      {DAY_RECIPE_PREFERENCE_STANCES.map((stance) => (
                        <option key={stance} value={stance}>
                          {DAY_STANCE_LABELS[stance]}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink">
                      Toevoegen
                    </button>
                  </div>
                </form>

                {dayPreferences.length > 0 && (
                  <div className="flex min-w-0 flex-col divide-y divide-line rounded-lg border border-line">
                    {dayPreferences.map((preference) => {
                      const variant = variantById.get(preference.subjectId);
                      if (!variant) return null;
                      return (
                        <div key={preference.id} className="flex min-w-0 items-center justify-between gap-3 p-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">{variant.recipe.title}</p>
                            <p className="text-xs text-ink-muted">
                              {DAY_STANCE_SHORT_LABELS[preference.stance] ?? preference.stance.toLowerCase()}
                            </p>
                          </div>
                          <form action={deleteDayRecipePreference} className="shrink-0">
                            <input type="hidden" name="householdId" value={householdId} />
                            <input type="hidden" name="dayKey" value={dayKey} />
                            <input type="hidden" name="recipeVariantId" value={variant.id} />
                            <button
                              type="submit"
                              aria-label={`${variant.recipe.title} van ${DAY_LABELS[dayKey]} verwijderen`}
                              title="Niet meer voor deze dag"
                              className="rounded-lg border border-line p-2 text-ink-faint transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                            >
                              <Trash2 size={14} />
                            </button>
                          </form>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
