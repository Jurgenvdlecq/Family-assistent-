import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getMealPlanForWeek } from "@/lib/mealPlan";
import { DAY_KEYS, DAY_ENUM, DAY_LABELS, getCurrentWeekStart, type DayKey } from "@/lib/week";
import NavBar from "@/components/NavBar";
import { replaceMealPlanEntry } from "./actions";

const DIRECTIONS = [
  { key: "all", label: "Alle suggesties" },
  { key: "favorites", label: "Favorieten" },
  { key: "quick", label: "Snel & makkelijk" },
] as const;

export default async function GerechtenPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; direction?: string }>;
}) {
  const params = await searchParams;

  const household = await prisma.household.findFirst({ orderBy: { createdAt: "asc" } });
  if (!household) redirect("/onboarding");

  const dayKey: DayKey = (DAY_KEYS as readonly string[]).includes(params.day ?? "")
    ? (params.day as DayKey)
    : "monday";
  const direction = params.direction ?? "all";

  const weekStart = getCurrentWeekStart();
  const mealPlan = await getMealPlanForWeek(household.id, weekStart);
  const currentEntry = mealPlan?.entries.find((e) => e.dayOfWeek === DAY_ENUM[dayKey]);

  const preferences = await prisma.preference.findMany({
    where: {
      ownerType: "HOUSEHOLD",
      ownerId: household.id,
      subjectType: "RECIPE_CATEGORY",
      stance: "LIKED",
    },
  });
  const preferredCategories = new Set(preferences.map((p) => p.subjectId));

  const variants = await prisma.recipeVariant.findMany({ include: { recipe: true } });

  let filtered = variants;
  if (direction === "favorites") {
    filtered = variants.filter((v) => preferredCategories.has(v.recipe.category));
  } else if (direction === "quick") {
    filtered = variants.filter(
      (v) => v.variantType === "FAST" || v.recipe.category === "QUICK_AND_EASY"
    );
  }
  filtered = filtered.filter((v) => v.id !== currentEntry?.recipeVariantId).slice(0, 12);

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10 pb-24">
      <p className="mb-1 font-mono text-xs uppercase tracking-wide text-orange-600">
        Vervangen voor {DAY_LABELS[dayKey]}
      </p>
      <h1 className="mb-6 text-2xl font-semibold">Waar hebben jullie zin in?</h1>

      <div className="mb-6 flex gap-2">
        {DIRECTIONS.map((d) => (
          <a
            key={d.key}
            href={`/gerechten?day=${dayKey}&direction=${d.key}`}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              direction === d.key
                ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400"
                : "border-neutral-300 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-400"
            }`}
          >
            {d.label}
          </a>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {filtered.length === 0 && (
          <p className="text-sm text-neutral-500">Geen andere gerechten gevonden in deze richting.</p>
        )}
        {filtered.map((variant) => (
          <form key={variant.id} action={replaceMealPlanEntry}>
            <input type="hidden" name="householdId" value={household.id} />
            <input type="hidden" name="dayKey" value={dayKey} />
            <input type="hidden" name="recipeVariantId" value={variant.id} />
            <input type="hidden" name="weekStart" value={weekStart.toISOString()} />
            <button
              type="submit"
              className="flex w-full items-center justify-between rounded-xl border border-neutral-200 p-4 text-left transition-colors hover:border-orange-300 dark:border-neutral-800"
            >
              <div>
                <p className="font-medium">{variant.recipe.title}</p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {variant.recipe.properties.slice(0, 3).join(" · ")}
                </p>
              </div>
              <span className="shrink-0 text-sm font-medium text-orange-600">Kies dit</span>
            </button>
          </form>
        ))}
      </div>

      <NavBar />
    </div>
  );
}
