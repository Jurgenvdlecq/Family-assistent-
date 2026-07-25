import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ensureMealPlan, getMealPlanForWeek, getReasonsForPlan } from "@/lib/mealPlan";
import { getCurrentWeekStart, DAY_KEYS, DAY_LABELS, DAY_ENUM } from "@/lib/week";
import NavBar from "@/components/NavBar";
import { submitMealFeedback } from "./actions";

const VARIANT_LABELS: Record<string, string> = {
  FAST: "Snel & makkelijk",
  FRESH: "Vers",
  REHEATABLE: "Opwarmbaar",
  KID_FRIENDLY: "Kindvriendelijk",
};

const STATUS_LABELS: Record<string, string> = {
  FOUND: "Nieuwe suggestie",
  ADAPTED: "Nieuwe suggestie",
  PROVEN: "Beproefd",
  SAFE_CHOICE: "Veilige keuze",
};

export default async function Home() {
  const household = await prisma.household.findFirst({ orderBy: { createdAt: "asc" } });
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

  // "Eenmalig" vragen (sectie 7): ongeacht het antwoord, niet opnieuw vragen
  // zodra er al expliciete feedback is gegeven voor dit gerecht.
  const variantIds = mealPlan!.entries.map((e) => e.recipeVariantId);
  const priorFeedback = await prisma.feedbackEvent.findMany({
    where: {
      householdId: household.id,
      subjectType: "RECIPE_VARIANT",
      subjectId: { in: variantIds },
      eventType: "EXPLICIT_FEEDBACK",
    },
    select: { subjectId: true },
  });
  const alreadyAsked = new Set(priorFeedback.map((f) => f.subjectId));

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10 pb-24">
      <p className="mb-1 font-mono text-xs uppercase tracking-wide text-orange-600">Jouw week</p>
      <h1 className="mb-1 text-2xl font-semibold">Goedemorgen, {household.name}!</h1>
      <p className="mb-8 text-neutral-600 dark:text-neutral-400">
        Dit is jullie weekplanning. Ik houd rekening met jullie voorkeuren en drukke dagen.
      </p>

      <div className="flex flex-col divide-y divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {DAY_KEYS.map((dayKey) => {
          const entry = entryByDay.get(DAY_ENUM[dayKey]);
          const recipe = entry?.recipeVariant.recipe;
          const reason = entry ? reasons.get(entry.recipeVariantId) : undefined;
          const isNew =
            entry &&
            recipe &&
            (recipe.status === "FOUND" || recipe.status === "ADAPTED") &&
            !alreadyAsked.has(entry.recipeVariantId);

          return (
            <div key={dayKey} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                    {DAY_LABELS[dayKey]}
                  </p>
                  <p className="font-medium">{recipe?.title ?? "—"}</p>
                  {entry && (
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {VARIANT_LABELS[entry.recipeVariant.variantType]}
                      {recipe && (
                        <>
                          {" · "}
                          <span
                            className={
                              recipe.status === "SAFE_CHOICE"
                                ? "font-medium text-green-600"
                                : undefined
                            }
                          >
                            {STATUS_LABELS[recipe.status]}
                          </span>
                        </>
                      )}
                    </p>
                  )}
                  {reason && <p className="mt-1 max-w-sm text-xs text-neutral-500">{reason}</p>}
                </div>
                <a
                  href={`/gerechten?day=${dayKey}`}
                  className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                >
                  Vervangen
                </a>
              </div>

              {isNew && entry && (
                <div className="flex items-center justify-between rounded-lg bg-blue-50 px-3 py-2 dark:bg-blue-950/20">
                  <span className="text-xs text-blue-800 dark:text-blue-300">
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
                        className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-blue-700 shadow-sm hover:bg-blue-100 dark:bg-neutral-900 dark:text-blue-300"
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
                        className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-neutral-500 shadow-sm hover:bg-neutral-100 dark:bg-neutral-900"
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

      <a
        href="/boodschappen"
        className="mt-8 rounded-lg bg-orange-500 px-4 py-3 text-center font-medium text-white transition-colors hover:bg-orange-600"
      >
        Naar boodschappenlijst
      </a>

      <NavBar />
    </div>
  );
}
