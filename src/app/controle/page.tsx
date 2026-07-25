import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getMealPlanForWeek } from "@/lib/mealPlan";
import { getCurrentWeekStart } from "@/lib/week";
import { ensureShoppingList, getShoppingListCandidates } from "@/lib/shoppingList";
import NavBar from "@/components/NavBar";
import { confirmProductChoice, skipReview, confirmShoppingList } from "./actions";

function formatPrice(price: unknown) {
  if (price === null || price === undefined) return null;
  return `€ ${Number(price).toFixed(2)}`;
}

export default async function ControlePage() {
  const household = await prisma.household.findFirst({ orderBy: { createdAt: "asc" } });
  if (!household) redirect("/onboarding");

  const weekStart = getCurrentWeekStart();
  const mealPlan = await getMealPlanForWeek(household.id, weekStart);
  if (!mealPlan) redirect("/");

  const shoppingList = await ensureShoppingList(mealPlan.id, household.id);

  const trustedLines = shoppingList.lines.filter((l) => !l.needsReview);
  const reviewLines = shoppingList.lines.filter((l) => l.needsReview);

  const candidatesByLine = new Map<string, Awaited<ReturnType<typeof getShoppingListCandidates>>>();
  for (const line of reviewLines) {
    candidatesByLine.set(line.id, await getShoppingListCandidates(line.ingredientId));
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10 pb-24">
      <p className="mb-1 font-mono text-xs uppercase tracking-wide text-orange-600">Controle</p>
      <h1 className="mb-2 text-2xl font-semibold">
        {reviewLines.length === 0 ? "Alles staat klaar!" : "Alles staat bijna klaar"}
      </h1>
      <p className="mb-6 text-neutral-600 dark:text-neutral-400">
        Ik heb {shoppingList.lines.length} producten voorbereid op basis van jullie weekplanning.
      </p>

      <div className="mb-8 flex gap-2 text-sm">
        <span className="rounded-full bg-green-50 px-3 py-1 font-medium text-green-700 dark:bg-green-950/30 dark:text-green-400">
          {trustedLines.length} vertrouwde keuzes
        </span>
        {reviewLines.length > 0 && (
          <span className="rounded-full bg-amber-50 px-3 py-1 font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
            {reviewLines.length} vragen aandacht
          </span>
        )}
      </div>

      {reviewLines.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 text-sm font-semibold text-neutral-500">Even jullie hulp nodig</h2>
          <div className="flex flex-col gap-4">
            {reviewLines.map((line) => {
              const candidates = candidatesByLine.get(line.id) ?? [];
              return (
                <div
                  key={line.id}
                  className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/10"
                >
                  <p className="mb-2 font-medium">{line.ingredient.name}</p>

                  {candidates.length === 0 && (
                    <>
                      <p className="mb-3 text-sm text-neutral-500">
                        Geen product gevonden voor dit ingrediënt — voeg het later zelf toe.
                      </p>
                      <form action={skipReview}>
                        <input type="hidden" name="lineId" value={line.id} />
                        <button
                          type="submit"
                          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium dark:border-neutral-700"
                        >
                          Begrepen
                        </button>
                      </form>
                    </>
                  )}

                  {candidates.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {candidates.map((candidate) => (
                        <form key={candidate.id} action={confirmProductChoice}>
                          <input type="hidden" name="lineId" value={line.id} />
                          <input type="hidden" name="productId" value={candidate.id} />
                          <input type="hidden" name="householdId" value={household.id} />
                          <button
                            type="submit"
                            className="flex w-full items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-sm hover:border-orange-300 dark:border-neutral-700 dark:bg-neutral-900"
                          >
                            <span>
                              {candidate.name}
                              {candidate.brand && (
                                <span className="text-neutral-400"> — {candidate.brand}</span>
                              )}
                              {candidate.packageSize && (
                                <span className="text-neutral-400"> · {candidate.packageSize}</span>
                              )}
                            </span>
                            <span className="shrink-0 font-medium text-orange-600">
                              {formatPrice(candidate.price) ?? "Kies"}
                            </span>
                          </button>
                        </form>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-neutral-500">
          Alle andere producten ({trustedLines.length})
        </h2>
        <p className="text-sm text-neutral-500">
          {trustedLines.length} producten zijn automatisch goedgekeurd.
        </p>
      </div>

      <form action={confirmShoppingList}>
        <input type="hidden" name="shoppingListId" value={shoppingList.id} />
        <button
          type="submit"
          disabled={reviewLines.length > 0}
          className="w-full rounded-lg bg-orange-500 px-4 py-3 text-center font-medium text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {reviewLines.length > 0 ? "Los eerst de twijfelgevallen op" : "Bevestigen"}
        </button>
      </form>

      <NavBar />
    </div>
  );
}
