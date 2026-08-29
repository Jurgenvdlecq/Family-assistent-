import Link from "next/link";
import { ChevronLeft, Tags, AlertTriangle } from "lucide-react";
import { requireCurrentHousehold } from "@/lib/auth";
import { ensureMealPlan } from "@/lib/mealPlan";
import { getCurrentWeekStart } from "@/lib/week";
import { getBasketOverview, COMPARISON_PROVIDERS } from "@/lib/pricing/basket";
import { EQUIVALENCE_LABELS, type EquivalenceLevel } from "@/domain/pricing/equivalence";
import { PROVIDER_LABELS } from "@/domain/pricing/types";
import { describeProviderSource } from "@/domain/pricing/providers/capabilities";
import type { ProductProvider } from "@/generated/prisma/enums";
import type { StorePriceForIngredient } from "@/lib/pricing/storePrices";
import NavBar from "@/components/NavBar";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import { chooseStoreProduct, clearStoreProductChoice } from "./actions";

// Leest de actuele boodschappenlijst en maakt (idempotent) het weekplan aan —
// nooit statisch prerenderen.
export const dynamic = "force-dynamic";

const STATUS_MESSAGES: Record<string, string> = {
  "keuze-opgeslagen": "Onthouden. Vanaf nu rekent de vergelijking met dit product.",
  "keuze-gewist": "Keuze losgelaten. De app kiest hier weer zelf.",
};

function euro(value: number) {
  return `€ ${value.toFixed(2).replace(".", ",")}`;
}

function formatQuantity(quantity: number, unit: string) {
  if (unit === "GRAM") return `${quantity} g`;
  if (unit === "ML") return `${quantity} ml`;
  return `${Math.ceil(quantity)}x`;
}

const LEVEL_STYLES: Record<EquivalenceLevel, string> = {
  IDENTIEK: "bg-tag-green-bg text-tag-green-ink",
  GELIJKWAARDIG: "bg-tag-green-bg text-tag-green-ink",
  ALTERNATIEF: "bg-tag-amber-bg text-tag-amber-ink",
  NIET_VERGELIJKBAAR: "bg-surface-2 text-ink-muted",
};

/**
 * Het verschil in gewone taal, of eerlijk niets.
 *
 * Er staat alleen een percentage als beide kanten over dezelfde regels gaan.
 * Een "besparing" die alleen bestaat omdat de winkel de helft van de lijst
 * niet heeft, is geen besparing maar een rekenfout.
 */
function describeDifference(storeTotal: number, ownTotal: number, linesCompared: number) {
  if (linesCompared === 0 || ownTotal <= 0) return null;
  const difference = storeTotal - ownTotal;
  if (Math.abs(difference) < 0.01) return "even duur";
  const percent = Math.round((Math.abs(difference) / ownTotal) * 100);
  return difference < 0
    ? `${euro(Math.abs(difference))} goedkoper (${percent}%)`
    : `${euro(difference)} duurder (${percent}%)`;
}

export default async function PrijzenPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string; status?: string }>;
}) {
  const params = await searchParams;
  const household = await requireCurrentHousehold();
  const focusedLineId = String(params.focus ?? "").trim();
  const statusMessage = params.status ? STATUS_MESSAGES[params.status] : undefined;

  const mealPlan = await ensureMealPlan(household.id, getCurrentWeekStart());
  if (!mealPlan) throw new Error("Weekplanning kon niet worden geladen.");

  const overview = await getBasketOverview(household.id, mealPlan.id);
  const { comparison, candidatesByIngredient, choicesByIngredient, lineMeta } = overview;
  const providers = COMPARISON_PROVIDERS;
  const providersWithData = providers.filter((provider) =>
    comparison.lines.some((line) => line.stores.has(provider))
  );

  return (
    <div className="mx-auto flex min-h-screen w-full min-w-0 max-w-2xl flex-col pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between px-6 pb-2 pt-6">
        <Link href="/boodschappen" aria-label="Terug naar boodschappen" className="text-ink-muted">
          <ChevronLeft size={22} />
        </Link>
        <span className="text-sm font-semibold">Wat kost deze lijst?</span>
        <Tags size={18} className="text-ink-muted" />
      </header>

      <div className="min-w-0 px-6 pt-4">
        <h1 className="mb-1 text-[1.6rem] font-semibold leading-tight text-ink">
          Je boodschappen bij een andere winkel
        </h1>
        <p className="mb-5 text-[15px] text-ink-muted">
          Dit is een doorrekening van je hele lijst, geen prijsvergelijker: je koopt verpakkingen, geen
          liters. Bestellen gaat en blijft via Picnic — dit scherm geeft alleen inzicht.
        </p>

        {statusMessage && (
          <p className="mb-5 rounded-lg border border-tag-green-ink/20 bg-tag-green-bg px-3 py-2 text-sm font-medium text-tag-green-ink">
            {statusMessage}
          </p>
        )}

        {comparison.lines.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface p-4 text-sm text-ink-muted">
            Er staat nog niets op je boodschappenlijst om door te rekenen.
          </p>
        ) : (
          <>
            <section className="mb-6 rounded-xl border border-line bg-surface p-4">
              <p className="text-sm text-ink-muted">Jouw lijst zoals hij nu bij Picnic staat</p>
              <p className="text-2xl font-semibold text-ink">{euro(comparison.referenceTotal)}</p>
              <p className="mt-0.5 text-xs text-ink-faint">
                {comparison.lines.length} {comparison.lines.length === 1 ? "regel" : "regels"}
                {comparison.referenceLinesMissing > 0 &&
                  ` · van ${comparison.referenceLinesMissing} ${
                    comparison.referenceLinesMissing === 1 ? "regel weten we" : "regels weten we"
                  } de prijs nog niet`}
              </p>

              {providers.map((provider) => {
                const total = comparison.totals.get(provider);
                if (!total) return null;
                const difference = describeDifference(
                  total.hardTotal,
                  total.referenceTotalForHardLines,
                  total.linesCompared
                );
                return (
                  <div key={provider} className="mt-4 border-t border-line pt-4">
                    <p className="text-sm font-medium text-ink">Bij {PROVIDER_LABELS[provider]}</p>
                    {describeProviderSource(provider) && (
                      <p className="text-xs text-ink-faint">{describeProviderSource(provider)}</p>
                    )}
                    {total.linesCompared === 0 ? (
                      <p className="mt-1 text-sm text-ink-muted">
                        Nog geen enkele regel te vergelijken. Dat is geen €&nbsp;0 — het betekent dat we
                        hier nog geen prijzen van hebben.
                      </p>
                    ) : (
                      <>
                        {/* Drie getallen, nooit één: hetzelfde-of-gelijkwaardig,
                            inclusief alternatieven, en wat er niet te vergelijken viel. */}
                        <p className="text-2xl font-semibold text-ink">{euro(total.hardTotal)}</p>
                        <p className="text-xs text-ink-faint">
                          voor {total.linesCompared} van de {comparison.lines.length} regels — bij Picnic{" "}
                          {euro(total.referenceTotalForHardLines)} voor diezelfde regels
                          {difference ? `, dus ${difference}` : ""}
                        </p>
                        {total.linesWithAlternative > 0 && (
                          <p className="mt-2 text-sm text-ink-muted">
                            {euro(total.alternativeTotal)} als je ook {total.linesWithAlternative}{" "}
                            {total.linesWithAlternative === 1 ? "ander soort product" : "andere soorten product"}{" "}
                            meerekent — bij Picnic {euro(total.referenceTotalForAlternativeLines)} voor
                            diezelfde regels. Dat is dan wel iets anders in huis.
                          </p>
                        )}
                      </>
                    )}
                    {total.linesMissing > 0 && (
                      <p className="mt-2 flex items-start gap-1.5 text-sm text-ink-muted">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-tag-amber-ink" />
                        <span>
                          {total.linesMissing} {total.linesMissing === 1 ? "regel telt" : "regels tellen"} niet
                          mee. Het bedrag hierboven is dus geen prijs voor je hele lijst.
                        </span>
                      </p>
                    )}
                    {total.anyStale && total.oldestObservation && (
                      <p className="mt-1 text-xs text-ink-faint">
                        Oudste prijs van{" "}
                        {total.oldestObservation.toLocaleDateString("nl-NL", {
                          day: "numeric",
                          month: "long",
                        })}
                        .
                      </p>
                    )}
                  </div>
                );
              })}
            </section>

            <h2 className="mb-2 text-sm font-semibold text-ink">Regel voor regel</h2>
            {/* Een winkel waar we vandaag helemaal niets van weten krijgt geen
                kolom per regel: vijftien keer "geen prijs bekend" voegt niets
                toe aan het ene bericht hierboven. */}
            <div className="mb-8 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {comparison.lines.map((line) => {
                const meta = lineMeta.get(line.lineId);
                const ingredientId = meta?.ingredientId ?? "";
                return (
                  <div
                    key={line.lineId}
                    id={`regel-${line.lineId}`}
                    className={`scroll-mt-6 p-4 ${line.lineId === focusedLineId ? "bg-accent-soft" : ""}`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 truncate font-medium text-ink">{line.ingredientName}</p>
                      <p className="shrink-0 text-xs text-ink-faint">
                        {formatQuantity(line.neededQuantity, line.unit)} nodig
                      </p>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-faint">
                      Picnic:{" "}
                      {line.referenceName
                        ? `${line.referenceName}${
                            line.referenceCost !== null
                              ? ` · ${line.referencePackages}x · ${euro(line.referenceCost)}`
                              : " · prijs onbekend"
                          }`
                        : "nog geen product gekozen"}
                    </p>

                    {providersWithData.map((provider) => {
                      const store = line.stores.get(provider);
                      const chosenProductId = ingredientId
                        ? choicesByIngredient.get(ingredientId)?.get(provider)
                        : undefined;
                      const candidates = (candidatesByIngredient.get(ingredientId) ?? []).filter(
                        (candidate) => candidate.provider === provider
                      );

                      return (
                        <div key={provider} className="mt-2 rounded-lg bg-surface-2 p-3">
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="text-sm font-medium text-ink">{PROVIDER_LABELS[provider]}</p>
                            {store && (
                              <p className="shrink-0 text-sm text-ink">
                                {store.cost !== null ? euro(store.cost) : "—"}
                              </p>
                            )}
                          </div>

                          {!store ? (
                            // Nadrukkelijk geen nul: niet gevonden is iets anders dan gratis.
                            <p className="mt-0.5 text-xs text-ink-muted">
                              Geen prijs bekend. Deze regel telt niet mee in het totaal.
                            </p>
                          ) : (
                            <>
                              <p className="mt-0.5 text-xs text-ink-muted">
                                {store.name}
                                {store.packageSize ? ` · ${store.packageSize}` : ""}
                                {store.packagesToBuy !== null ? ` · ${store.packagesToBuy}x` : ""}
                              </p>
                              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                                <span className={`rounded px-1.5 py-0.5 ${LEVEL_STYLES[store.level]}`}>
                                  {EQUIVALENCE_LABELS[store.level]}
                                </span>
                                <span className="text-ink-faint">{store.levelReason}</span>
                              </p>
                              {store.surplus !== null && store.surplus > 0 && (
                                <p className="mt-0.5 text-xs text-ink-faint">
                                  {formatQuantity(store.surplus, line.unit)} over — dat is geen besparing als
                                  het weg moet.
                                </p>
                              )}
                              {store.promoLabel && (
                                <p className="mt-0.5 text-xs text-tag-green-ink">{store.promoLabel}</p>
                              )}
                              {store.missingReason && (
                                <p className="mt-0.5 text-xs text-tag-amber-ink">
                                  Telt niet mee: {store.missingReason}.
                                </p>
                              )}
                              {store.stale && (
                                <p className="mt-0.5 text-xs text-ink-faint">Prijs is ouder dan een dag.</p>
                              )}
                            </>
                          )}

                          {/* Bewust buiten de "is er een resultaat"-tak: juist
                              als een gekozen product géén prijs meer oplevert,
                              moet de gebruiker die keuze kunnen loslaten. */}
                          {chosenProductId && (
                            <form action={clearStoreProductChoice} className="mt-1">
                              <input type="hidden" name="ingredientId" value={ingredientId} />
                              <input type="hidden" name="provider" value={provider} />
                              <input type="hidden" name="lineId" value={line.lineId} />
                              <PendingSubmitButton
                                pendingText="Bezig…"
                                className="text-xs font-medium text-accent underline"
                              >
                                Jullie keuze — weer automatisch laten kiezen
                              </PendingSubmitButton>
                            </form>
                          )}

                          {candidates.length > 1 && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs font-medium text-accent">
                                Ander product kiezen
                              </summary>
                              <div className="mt-2 space-y-1">
                                {candidates.map((candidate) => (
                                  <StoreCandidateRow
                                    key={candidate.productId}
                                    candidate={candidate}
                                    ingredientId={ingredientId}
                                    lineId={line.lineId}
                                    selected={candidate.productId === chosenProductId}
                                  />
                                ))}
                              </div>
                            </details>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <NavBar />
    </div>
  );
}

function StoreCandidateRow({
  candidate,
  ingredientId,
  lineId,
  selected,
}: {
  candidate: StorePriceForIngredient;
  ingredientId: string;
  lineId: string;
  selected: boolean;
}) {
  return (
    <form action={chooseStoreProduct} className="flex items-center justify-between gap-3">
      <input type="hidden" name="ingredientId" value={ingredientId} />
      <input type="hidden" name="productId" value={candidate.productId} />
      <input type="hidden" name="provider" value={candidate.provider satisfies ProductProvider} />
      <input type="hidden" name="lineId" value={lineId} />
      <span className="min-w-0 truncate text-xs text-ink-muted">
        {candidate.name}
        {candidate.packageSize ? ` · ${candidate.packageSize}` : ""} · {euro(candidate.price)}
      </span>
      {selected ? (
        <span className="shrink-0 text-xs font-medium text-tag-green-ink">Gekozen</span>
      ) : (
        <PendingSubmitButton
          pendingText="…"
          className="shrink-0 rounded-md border border-line px-2 py-1 text-xs font-medium text-ink"
        >
          Kies
        </PendingSubmitButton>
      )}
    </form>
  );
}
