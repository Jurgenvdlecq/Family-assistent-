import { redirect } from "next/navigation";
import { Menu, SlidersHorizontal, Flame, Leaf, MoreHorizontal, Utensils } from "lucide-react";
import { prisma } from "@/lib/prisma";
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
import { CATEGORY_GRADIENT, VARIANT_LABELS, STATUS_LABELS, statusTone, variantTone } from "@/lib/categoryStyle";
import NavBar from "@/components/NavBar";
import Tag from "@/components/Tag";
import { submitMealFeedback } from "./actions";

export default async function Home() {
  const household = await prisma.household.findFirst({
    orderBy: { createdAt: "asc" },
    include: { persons: { orderBy: { createdAt: "asc" } } },
  });
  if (!household) {
    redirect("/onboarding");
  }

  const weekStart = getCurrentWeekStart();
  await ensureMealPlan(household.id, weekStart);
  const [mealPlan, reasons] = await Promise.all([
    getMealPlanForWeek(household.id, weekStart),
    getReasonsForPlan(household.id, weekStart),
  ]);

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
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col pb-24">
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

      <div className="flex flex-col divide-y divide-line border-y border-line bg-surface">
        {DAY_KEYS.map((dayKey) => {
          const entry = entryByDay.get(DAY_ENUM[dayKey]);
          const recipe = entry?.recipeVariant.recipe;
          const reason = entry ? reasons.get(entry.recipeVariantId) : undefined;
          const isNew =
            entry &&
            recipe &&
            (recipe.status === "FOUND" || recipe.status === "ADAPTED") &&
            !alreadyAsked.has(entry.recipeVariantId);
          const gradient = recipe ? CATEGORY_GRADIENT[recipe.category] : "from-neutral-200 to-neutral-300";

          return (
            <div key={dayKey} className="flex flex-col gap-3 px-6 py-4">
              <div className="flex items-center gap-3">
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
