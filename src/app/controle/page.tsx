import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ClipboardCheck, CheckCircle2, AlertCircle, HelpCircle } from "lucide-react";
import { requireCurrentHousehold } from "@/lib/auth";
import { getMealPlanForWeek } from "@/lib/mealPlan";
import { getCurrentWeekStart } from "@/lib/week";
import { ensureShoppingList, getShoppingListCandidates, describeLinePackaging } from "@/lib/shoppingList";
import NavBar from "@/components/NavBar";
import Tag from "@/components/Tag";
import {
  confirmProductChoice,
  rejectProductChoice,
  useProductThisWeekOnly,
  adjustLineQuantity,
  removeLineFromList,
  skipReview,
  confirmShoppingList,
} from "./actions";

// ensureShoppingList schrijft (idempotent) naar de database — nooit
// statisch prerenderen tijdens de build.
export const dynamic = "force-dynamic";

const UNIT_LABELS: Record<string, string> = { GRAM: "gram", ML: "ml", PIECE: "stuks" };

function formatPrice(price: unknown) {
  if (price === null || price === undefined) return null;
  return `€ ${Number(price).toFixed(2)}`;
}

function formatQuantity(quantity: number, unit: string) {
  if (unit === "GRAM") return `${quantity} g`;
  if (unit === "ML") return `${quantity} ml`;
  return `${quantity}x`;
}

/** "2 verpakkingen · 1000 g totaal · 200 g over" — of niets als de verpakking onbekend is (Fase 3). */
function PackagingLine({
  line,
  product,
}: {
  line: { quantity: number; unit: string };
  product: { packageQuantity: number | null } | null | undefined;
}) {
  const breakdown = describeLinePackaging(
    { quantity: line.quantity, unit: line.unit as "GRAM" | "ML" | "PIECE" },
    product
  );
  if (breakdown.status !== "OK") return null;
  return (
    <p className="text-xs text-ink-faint">
      {breakdown.packagesToBuy} {breakdown.packagesToBuy === 1 ? "verpakking" : "verpakkingen"} ·{" "}
      {formatQuantity(breakdown.totalPurchased!.amount, breakdown.totalPurchased!.unit)} totaal
      {breakdown.expectedSurplus!.amount > 0 && (
        <> · {formatQuantity(breakdown.expectedSurplus!.amount, breakdown.expectedSurplus!.unit)} over</>
      )}
    </p>
  );
}

export default async function ControlePage() {
  const household = await requireCurrentHousehold();

  const weekStart = getCurrentWeekStart();
  const mealPlan = await getMealPlanForWeek(household.id, weekStart);
  if (!mealPlan) redirect("/");

  const shoppingList = await ensureShoppingList(mealPlan.id, household.id);

  const trustedLines = shoppingList.lines.filter((l) => !l.needsReview);
  const reviewLines = shoppingList.lines.filter((l) => l.needsReview);

  const candidatesByLine = new Map<string, Awaited<ReturnType<typeof getShoppingListCandidates>>>();
  for (const line of reviewLines) {
    candidatesByLine.set(line.id, await getShoppingListCandidates(household.id, line.ingredientId));
  }

  // Fase 6: "niet gevonden" is een apart geval van "aandacht nodig" — geen
  // enkel bekend product om uit te kiezen, dus andere acties dan een
  // twijfelgeval met wél kandidaten.
  const notFoundLines = reviewLines.filter((l) => (candidatesByLine.get(l.id) ?? []).length === 0);
  const attentionLines = reviewLines.filter((l) => (candidatesByLine.get(l.id) ?? []).length > 0);

  return (
    <div className="mx-auto flex min-h-screen w-full min-w-0 max-w-2xl flex-col pb-24">
      <header className="flex items-center justify-between px-6 pt-6 pb-2">
        <Link href="/" aria-label="Terug naar Jouw week" className="text-ink-muted">
          <ChevronLeft size={22} />
        </Link>
        <span className="text-sm font-semibold">Controle</span>
        <ClipboardCheck size={18} className="text-ink-muted" />
      </header>

      <div className="min-w-0 px-6 pt-4">
        <h1 className="mb-1 flex items-center gap-2 text-[1.6rem] font-semibold leading-tight text-ink">
          {reviewLines.length === 0 ? "Alles staat klaar" : "Alles staat bijna klaar"}
          <CheckCircle2 size={22} className="shrink-0 text-tag-green-ink" />
        </h1>
        <p className="mb-5 text-[15px] text-ink-muted">
          Ik heb {shoppingList.lines.length} producten voorbereid op basis van jullie weekplanning.
        </p>

        <div className="mb-7 flex flex-wrap gap-2">
          <Tag tone="green">{trustedLines.length} vertrouwde keuzes</Tag>
          {attentionLines.length > 0 && <Tag tone="amber">{attentionLines.length} vragen aandacht</Tag>}
          {notFoundLines.length > 0 && <Tag tone="amber">{notFoundLines.length} niet gevonden</Tag>}
        </div>

        {attentionLines.length > 0 && (
          <div className="mb-8">
            <div className="mb-3 flex items-center gap-1.5">
              <AlertCircle size={16} className="text-tag-amber-ink" />
              <h2 className="text-sm font-semibold text-ink">Even jullie hulp nodig</h2>
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              {attentionLines.map((line) => {
                const candidates = candidatesByLine.get(line.id) ?? [];
                return (
                  <div
                    key={line.id}
                    className="min-w-0 rounded-xl border border-tag-amber-ink/25 bg-tag-amber-bg p-4"
                  >
                    <p className="mb-1 font-medium text-ink">{line.ingredient.name}</p>
                    {line.matchReasons.length > 0 && (
                      <p className="mb-2 text-xs text-ink-muted">{line.matchReasons.join(" ")}</p>
                    )}

                    <form action={adjustLineQuantity} className="mb-3 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="lineId" value={line.id} />
                      <input
                        type="number"
                        name="quantity"
                        defaultValue={line.quantity}
                        step="any"
                        min="0.01"
                        className="w-20 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
                      />
                      <span className="text-xs text-ink-faint">
                        {UNIT_LABELS[line.unit] ?? line.unit} nodig
                      </span>
                      <button
                        type="submit"
                        className="rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-ink hover:border-accent/50"
                      >
                        Aantal bijwerken
                      </button>
                    </form>

                    <div className="flex min-w-0 flex-col gap-2">
                      {candidates.map((candidate) => (
                        <div
                          key={candidate.id}
                          className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-line bg-surface px-3 py-2"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <form action={confirmProductChoice} className="min-w-0 flex-1">
                              <input type="hidden" name="lineId" value={line.id} />
                              <input type="hidden" name="productId" value={candidate.id} />
                              <input type="hidden" name="householdId" value={household.id} />
                              <button
                                type="submit"
                                className="flex w-full min-w-0 items-center justify-between gap-3 text-left text-sm hover:opacity-80"
                              >
                                <span className="min-w-0 truncate">
                                  {candidate.name}
                                  {candidate.brand && (
                                    <span className="text-ink-faint"> — {candidate.brand}</span>
                                  )}
                                  {candidate.packageSize && (
                                    <span className="text-ink-faint"> · {candidate.packageSize}</span>
                                  )}
                                </span>
                                <span className="shrink-0 font-medium text-accent">
                                  {formatPrice(candidate.price) ?? "Kies"}
                                </span>
                              </button>
                            </form>
                            <form action={rejectProductChoice}>
                              <input type="hidden" name="lineId" value={line.id} />
                              <input type="hidden" name="productId" value={candidate.id} />
                              <input type="hidden" name="householdId" value={household.id} />
                              <button
                                type="submit"
                                aria-label={`${candidate.name} nooit meer voorstellen`}
                                title="Nooit meer voorstellen"
                                className="shrink-0 rounded-lg border border-line bg-surface px-2.5 py-2 text-xs text-ink-faint hover:border-red-300 hover:text-red-600"
                              >
                                Nooit
                              </button>
                            </form>
                          </div>

                          <PackagingLine line={line} product={candidate} />

                          <form action={useProductThisWeekOnly}>
                            <input type="hidden" name="lineId" value={line.id} />
                            <input type="hidden" name="productId" value={candidate.id} />
                            <input type="hidden" name="householdId" value={household.id} />
                            <button
                              type="submit"
                              className="text-xs font-medium text-ink-faint underline decoration-dotted hover:text-ink"
                            >
                              Alleen deze week
                            </button>
                          </form>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {notFoundLines.length > 0 && (
          <div className="mb-8">
            <div className="mb-3 flex items-center gap-1.5">
              <HelpCircle size={16} className="text-ink-faint" />
              <h2 className="text-sm font-semibold text-ink">Niet gevonden</h2>
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              {notFoundLines.map((line) => (
                <div key={line.id} className="min-w-0 rounded-xl border border-line bg-surface p-4">
                  <p className="mb-1 font-medium text-ink">{line.ingredient.name}</p>
                  <p className="mb-3 text-sm text-ink-muted">
                    {line.matchReasons[0] ?? "Geen product gevonden voor dit ingrediënt."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <form action={skipReview}>
                      <input type="hidden" name="lineId" value={line.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink"
                      >
                        Zonder product doorgaan
                      </button>
                    </form>
                    <form action={removeLineFromList}>
                      <input type="hidden" name="lineId" value={line.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink-faint hover:text-red-600"
                      >
                        Van lijst verwijderen
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-8">
          <details className="rounded-xl border border-line bg-surface p-4">
            <summary className="cursor-pointer text-sm font-medium text-ink">
              {trustedLines.length} vertrouwde keuzes
            </summary>
            <div className="mt-3 flex min-w-0 flex-col divide-y divide-line">
              {trustedLines.map((line) => (
                <div key={line.id} className="min-w-0 py-2">
                  <p className="truncate text-sm text-ink">
                    {line.product?.name ?? line.ingredient.name}
                  </p>
                  {line.matchReasons.length > 0 && (
                    <p className="truncate text-xs text-ink-faint">{line.matchReasons.join(" ")}</p>
                  )}
                  <PackagingLine line={line} product={line.product} />
                </div>
              ))}
            </div>
          </details>
        </div>

        <form action={confirmShoppingList}>
          <input type="hidden" name="shoppingListId" value={shoppingList.id} />
          <button
            type="submit"
            disabled={reviewLines.length > 0}
            className="w-full rounded-xl bg-accent px-4 py-3.5 text-center font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {reviewLines.length > 0 ? "Los eerst de twijfelgevallen op" : "Bevestigen"}
          </button>
        </form>
      </div>

      <NavBar />
    </div>
  );
}
