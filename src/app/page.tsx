import { Menu, SlidersHorizontal, Flame, Leaf, MoreHorizontal, Utensils } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireCurrentHousehold } from "@/lib/auth";
import { getHouseholdMealParticipantsByDay } from "@/lib/household";
import { ensureMealPlan, getMealPlanForWeek, getReasonsForPlan } from "@/lib/mealPlan";
import {
  getCurrentWeekStart,
  formatWeekRange,
  DAY_KEYS,
  DAY_LABELS,
  DAY_SHORT_LABELS,
  DAY_ENUM,
  dateForDay,
  formatDayShort,
} from "@/lib/week";
import {
  CATEGORY_GRADIENT,
  CATEGORY_LABELS,
  VARIANT_LABELS,
  STATUS_LABELS,
  statusTone,
  variantTone,
} from "@/lib/categoryStyle";
import NavBar from "@/components/NavBar";
import Tag from "@/components/Tag";
import { setPersonMealPreference, submitMealFeedback } from "./actions";

// Deze pagina schrijft (idempotent) naar de database bij elk bezoek
// (ensureMealPlan) — nooit statisch prerenderen tijdens de build, dat
// voert dezelfde databasecode uit met build-time state en botst met
// bestaande data.
export const dynamic = "force-dynamic";

const PERSONAL_STANCE_LABELS = {
  LIKED: "Favoriet",
  SOMETIMES: "Oké",
  RATHER_NOT: "Liever niet",
  NEVER: "Nooit",
} as const;

const PERSONAL_STANCE_TONES = {
  LIKED: "border-tag-green-ink bg-tag-green-bg text-tag-green-ink",
  SOMETIMES: "border-tag-blue-ink bg-tag-blue-bg text-tag-blue-ink",
  RATHER_NOT: "border-tag-amber-ink bg-tag-amber-bg text-tag-amber-ink",
  NEVER: "border-red-500 bg-red-50 text-red-700",
} as const;

const PERSONAL_STANCES = ["LIKED", "SOMETIMES", "RATHER_NOT", "NEVER"] as const;

function PreferenceButtons({
  householdId,
  personId,
  dayKey,
  subjectType,
  subjectId,
  currentStance,
}: {
  householdId: string;
  personId: string;
  dayKey: string;
  subjectType: "RECIPE_VARIANT" | "RECIPE_CATEGORY" | "INGREDIENT";
  subjectId: string;
  currentStance: string | undefined;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {PERSONAL_STANCES.map((stance) => (
        <form key={stance} action={setPersonMealPreference}>
          <input type="hidden" name="householdId" value={householdId} />
          <input type="hidden" name="personId" value={personId} />
          <input type="hidden" name="dayKey" value={dayKey} />
          <input type="hidden" name="subjectType" value={subjectType} />
          <input type="hidden" name="subjectId" value={subjectId} />
          <input type="hidden" name="stance" value={stance} />
          <button
            type="submit"
            className={`w-full rounded-md border px-2 py-1.5 text-[11px] font-medium ${
              currentStance === stance
                ? PERSONAL_STANCE_TONES[stance]
                : "border-line bg-surface text-ink-muted hover:border-accent"
            }`}
          >
            {PERSONAL_STANCE_LABELS[stance]}
          </button>
        </form>
      ))}
    </div>
  );
}

export default async function Home() {
  const currentHousehold = await requireCurrentHousehold();
  const household = await prisma.household.findUniqueOrThrow({
    where: { id: currentHousehold.id },
    include: { persons: { orderBy: { createdAt: "asc" } } },
  });

  const weekStart = getCurrentWeekStart();
  await ensureMealPlan(household.id, weekStart);
  const [mealPlan, reasons, participantsByDay] = await Promise.all([
    getMealPlanForWeek(household.id, weekStart),
    getReasonsForPlan(household.id, weekStart),
    getHouseholdMealParticipantsByDay(household.id),
  ]);
  const mealVariantIds = mealPlan!.entries.map((entry) => entry.recipeVariantId);
  const mealCategoryIds = [...new Set(mealPlan!.entries.map((entry) => entry.recipeVariant.recipe.category))];
  const mealIngredientIds = [
    ...new Set(
      mealPlan!.entries.flatMap((entry) =>
        entry.recipeVariant.recipe.ingredients.map((ri) => ri.ingredientId)
      )
    ),
  ];
  const participantIds = [
    ...new Set(DAY_KEYS.flatMap((dayKey) => participantsByDay[dayKey].map((person) => person.id))),
  ];
  const personalPreferences = await prisma.preference.findMany({
    where: {
      ownerType: "PERSON",
      ownerId: { in: participantIds },
      OR: [
        { subjectType: "RECIPE_VARIANT", subjectId: { in: mealVariantIds } },
        { subjectType: "RECIPE_CATEGORY", subjectId: { in: mealCategoryIds } },
        { subjectType: "INGREDIENT", subjectId: { in: mealIngredientIds } },
      ],
    },
  });
  const personalPreferenceByPersonAndVariant = new Map(
    personalPreferences.map((preference) => [
      `${preference.ownerId}:${preference.subjectType}:${preference.subjectId}`,
      preference.stance,
    ])
  );

  const entryByDay = new Map(mealPlan!.entries.map((e) => [e.dayOfWeek, e]));
  const rhythm = (household.weeklyRhythm ?? {}) as Partial<Record<string, "busy" | "quiet">>;
  const busyDayCount = DAY_KEYS.filter((k) => rhythm[k] === "busy").length;
  const avgDayCount = mealPlan!.entries.filter(
    (e) => e.recipeVariant.recipe.category === "ALL_VEGGIE_DAY"
  ).length;
  const greetingName = household.persons[0]?.name ?? household.name;

  const priorFeedback = await prisma.feedbackEvent.findMany({
    where: {
      householdId: household.id,
      subjectType: "RECIPE_VARIANT",
      subjectId: { in: mealPlan!.entries.map((e) => e.recipeVariantId) },
      eventType: "EXPLICIT_FEEDBACK",
    },
    select: { subjectId: true },
  });
  const alreadyAsked = new Set(priorFeedback.map((f) => f.subjectId));

  return (
    <div className="mx-auto flex min-h-screen w-full min-w-0 max-w-2xl flex-col pb-24">
      <header className="flex items-center justify-between px-6 pt-6 pb-2">
        <Menu size={20} className="text-ink-muted" />
        <span className="text-sm font-semibold">Jouw week</span>
        <SlidersHorizontal size={18} className="text-ink-muted" />
      </header>

      <div className="px-6 pt-4">
        <h1 className="mb-1 text-[1.7rem] font-semibold leading-tight text-ink">
          Goedemorgen, {greetingName}! 👋
        </h1>
        <p className="mb-5 text-[15px] text-ink-muted">
          Dit is jullie weekplanning. Ik houd rekening met jullie voorkeuren en drukke dagen.
        </p>

        <div className="mb-6 rounded-2xl border border-line bg-surface p-4">
          <p className="mb-3 text-sm font-semibold text-ink">
            Deze week {formatWeekRange(weekStart)}
          </p>
          <div className="flex flex-wrap gap-4 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <Utensils size={14} className="text-ink-faint" />
              {mealPlan!.entries.length} maaltijden
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Flame size={14} className="text-tag-amber-ink" />
              {busyDayCount} drukke {busyDayCount === 1 ? "dag" : "dagen"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Leaf size={14} className="text-tag-green-ink" />
              {avgDayCount} AVG-{avgDayCount === 1 ? "dag" : "dagen"}
            </span>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col divide-y divide-line border-y border-line bg-surface">
        {DAY_KEYS.map((dayKey) => {
          const entry = entryByDay.get(DAY_ENUM[dayKey]);
          const recipe = entry?.recipeVariant.recipe;
          const visibleIngredients =
            recipe?.ingredients
              .filter((ri, index, list) => list.findIndex((item) => item.ingredientId === ri.ingredientId) === index)
              .slice(0, 4) ?? [];
          const reason = entry ? reasons.get(entry.recipeVariantId) : undefined;
          const participants = participantsByDay[dayKey];
          const isNew =
            entry &&
            recipe &&
            (recipe.status === "FOUND" || recipe.status === "ADAPTED") &&
            !alreadyAsked.has(entry.recipeVariantId);
          const gradient = recipe ? CATEGORY_GRADIENT[recipe.category] : "from-neutral-200 to-neutral-300";

          return (
            <div key={dayKey} className="flex min-w-0 flex-col gap-3 px-6 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="w-11 shrink-0 text-center">
                  <p className="text-[10px] font-semibold tracking-wide text-ink-faint">
                    {DAY_SHORT_LABELS[dayKey]}
                  </p>
                  <p className="text-[11px] text-ink-faint">
                    {formatDayShort(dateForDay(weekStart, dayKey))}
                  </p>
                </div>

                <div
                  className={`h-14 w-14 shrink-0 rounded-xl bg-gradient-to-br ${gradient}`}
                  aria-hidden
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{recipe?.title ?? "—"}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {entry && (
                      <Tag tone={variantTone(entry.recipeVariant.variantType)}>
                        {VARIANT_LABELS[entry.recipeVariant.variantType]}
                      </Tag>
                    )}
                    {recipe && (
                      <Tag tone={statusTone(recipe.status)}>{STATUS_LABELS[recipe.status]}</Tag>
                    )}
                  </div>
                </div>

                <a
                  href={`/gerechten?day=${dayKey}`}
                  aria-label={`Vervang ${DAY_LABELS[dayKey].toLowerCase()}`}
                  className="shrink-0 rounded-full p-2 text-ink-faint hover:bg-surface-2 hover:text-ink"
                >
                  <MoreHorizontal size={18} />
                </a>
              </div>

              {reason && (
                <p className="pl-14 text-xs text-ink-muted">{reason}</p>
              )}

              {entry && participants.length > 0 && (
                <details className="ml-14 rounded-lg border border-line bg-surface-2 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-ink-muted">
                    Persoonlijke voorkeuren
                  </summary>
                  <div className="mt-3 flex min-w-0 flex-col gap-3">
                    {participants.map((person) => {
                      const currentStance = personalPreferenceByPersonAndVariant.get(
                        `${person.id}:RECIPE_VARIANT:${entry.recipeVariantId}`
                      );
                      const categoryStance = personalPreferenceByPersonAndVariant.get(
                        `${person.id}:RECIPE_CATEGORY:${recipe?.category}`
                      );
                      return (
                        <div key={person.id} className="min-w-0">
                          <p className="mb-1.5 truncate text-xs font-medium text-ink">{person.name}</p>
                          <div className="flex min-w-0 flex-col gap-2">
                            <div>
                              <p className="mb-1 text-[11px] text-ink-faint">Dit gerecht</p>
                              <PreferenceButtons
                                householdId={household.id}
                                personId={person.id}
                                dayKey={dayKey}
                                subjectType="RECIPE_VARIANT"
                                subjectId={entry.recipeVariantId}
                                currentStance={currentStance}
                              />
                            </div>
                            {recipe && (
                              <div>
                                <p className="mb-1 text-[11px] text-ink-faint">
                                  {CATEGORY_LABELS[recipe.category] ?? recipe.category}
                                </p>
                                <PreferenceButtons
                                  householdId={household.id}
                                  personId={person.id}
                                  dayKey={dayKey}
                                  subjectType="RECIPE_CATEGORY"
                                  subjectId={recipe.category}
                                  currentStance={categoryStance}
                                />
                              </div>
                            )}
                            {visibleIngredients.map((ri) => {
                              const ingredientStance = personalPreferenceByPersonAndVariant.get(
                                `${person.id}:INGREDIENT:${ri.ingredientId}`
                              );
                              return (
                                <div key={ri.ingredientId}>
                                  <p className="mb-1 truncate text-[11px] text-ink-faint">
                                    {ri.ingredient.name}
                                  </p>
                                  <PreferenceButtons
                                    householdId={household.id}
                                    personId={person.id}
                                    dayKey={dayKey}
                                    subjectType="INGREDIENT"
                                    subjectId={ri.ingredientId}
                                    currentStance={ingredientStance}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}

              {isNew && entry && (
                <div className="ml-14 flex items-center justify-between rounded-lg bg-tag-blue-bg px-3 py-2">
                  <span className="text-xs text-tag-blue-ink">
                    Nieuw gerecht — hoe was dit voor {DAY_LABELS[dayKey].toLowerCase()}?
                  </span>
                  <div className="flex gap-1.5">
                    <form action={submitMealFeedback}>
                      <input type="hidden" name="householdId" value={household.id} />
                      <input type="hidden" name="recipeVariantId" value={entry.recipeVariantId} />
                      <input type="hidden" name="dayKey" value={dayKey} />
                      <input type="hidden" name="positive" value="true" />
                      <button
                        type="submit"
                        className="rounded-md bg-surface px-2.5 py-1 text-xs font-medium text-tag-blue-ink shadow-sm hover:opacity-80"
                      >
                        Werkte goed
                      </button>
                    </form>
                    <form action={submitMealFeedback}>
                      <input type="hidden" name="householdId" value={household.id} />
                      <input type="hidden" name="recipeVariantId" value={entry.recipeVariantId} />
                      <input type="hidden" name="dayKey" value={dayKey} />
                      <input type="hidden" name="positive" value="false" />
                      <button
                        type="submit"
                        className="rounded-md bg-surface px-2.5 py-1 text-xs font-medium text-ink-muted shadow-sm hover:opacity-80"
                      >
                        Niet echt
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-6">
        <a
          href="/boodschappen"
          className="mt-6 block rounded-xl bg-accent px-4 py-3.5 text-center font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          Naar boodschappenlijst
        </a>
      </div>

      <NavBar />
    </div>
  );
}
