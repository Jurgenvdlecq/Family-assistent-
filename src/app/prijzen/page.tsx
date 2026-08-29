import Link from "next/link";
import { ChevronLeft, Tags, AlertTriangle, ExternalLink } from "lucide-react";
import { requireCurrentHousehold } from "@/lib/auth";
import { ensureMealPlan } from "@/lib/mealPlan";
import { getCurrentWeekStart } from "@/lib/week";
import { getBasketOverview, COMPARISON_PROVIDERS } from "@/lib/pricing/basket";
import { EQUIVALENCE_LABELS, type EquivalenceLevel } from "@/domain/pricing/equivalence";
import { PROVIDER_LABELS } from "@/domain/pricing/types";
import { describeProviderSource } from "@/domain/pricing/providers/capabilities";
import { describeSplitAdvice } from "@/domain/pricing/splitAdvice";
import { getLastRefreshRuns, describeRefreshRun } from "@/lib/pricing/refreshRuns";
import {
  compareLineAcrossStores,
  comparisonColumns,
  describeUncomparableStore,
  showsPromotion,
} from "@/domain/pricing/lineComparison";
import { formatUnitPrice } from "@/domain/pricing/unitPrice";
import type { ProductProvider } from "@/generated/prisma/enums";
import type { StorePriceForIngredient } from "@/lib/pricing/storePrices";
import NavBar from "@/components/NavBar";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import { chooseStoreProduct, clearStoreProductChoice, refreshPricesNow } from "./actions";

// Leest de actuele boodschappenlijst en maakt (idempotent) het weekplan aan —
// nooit statisch prerenderen.
export const dynamic = "force-dynamic";

const STATUS_MESSAGES: Record<string, string> = {
  "keuze-opgeslagen": "Onthouden. Vanaf nu rekent de vergelijking met dit product.",
  "keuze-gewist": "Keuze losgelaten. De app kiest hier weer zelf.",
  ververst: "Klaar. Hieronder staat per winkel wat het opleverde.",
  "verversen-mislukt": "Er is niets opgehaald. Hieronder staat per winkel waarom.",
  "verversing-loopt-al": "Er loopt al een verversing. Even geduld, en ververs daarna de pagina.",
};

/**
 * Welke meldingen géén succes zijn.
 *
 * Een groene "klaar"-balk boven een scherm waar nul producten zijn opgehaald,
 * is precies de schijn die deze app niet hoort te wekken.
 */
const WARNING_STATUSES = new Set(["verversen-mislukt", "verversing-loopt-al"]);

// Een handmatige verversing doet echte aanvragen naar de winkels. Dat mag
// even duren, maar niet eindeloos — Vercel breekt een te lange aanroep af.
export const maxDuration = 60;

function euro(value: number) {
  return `€ ${value.toFixed(2).replace(".", ",")}`;
}

function formatDay(date: Date) {
  return date.toLocaleDateString("nl-NL", { day: "numeric", month: "long" });
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

  const [overview, lastRuns] = await Promise.all([
    getBasketOverview(household.id, mealPlan.id),
    getLastRefreshRuns(COMPARISON_PROVIDERS),
  ]);
  const { comparison, candidatesByIngredient, choicesByIngredient, lineMeta } = overview;
  const providers = COMPARISON_PROVIDERS;
  // Picnic hoort als kolom naast de winkels te staan, niet als losse alinea
  // eronder: de vraag is "wat kost dit hier, en daar" — dan wil je de bedragen
  // naast elkaar zien.
  const columns = comparisonColumns(providers);
  // Een winkel waar we vandaag helemaal niets van weten krijgt geen detailblok
  // per regel: vijftien keer "geen prijs bekend" voegt niets toe.
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
          <p
            className={`mb-5 rounded-lg border px-3 py-2 text-sm font-medium ${
              WARNING_STATUSES.has(params.status ?? "")
                ? "border-tag-amber-ink/20 bg-tag-amber-bg text-tag-amber-ink"
                : "border-tag-green-ink/20 bg-tag-green-bg text-tag-green-ink"
            }`}
          >
            {statusMessage}
          </p>
        )}

        {/* Bewust buiten het lijstblok: verversen hangt niet van de
            boodschappenlijst af (het gaat om je receptenboek en je vaste
            boodschappen), en juist een huishouden zonder lijst heeft deze
            knop het hardst nodig. */}
        <section className="mb-6 rounded-xl border border-line bg-surface p-4">
          <div className="space-y-1">
            {providers.map((provider) => (
              <p key={provider} className="text-xs text-ink-faint">
                {describeRefreshRun(lastRuns.get(provider), PROVIDER_LABELS[provider])}
              </p>
            ))}
          </div>
          <form action={refreshPricesNow} className="mt-2">
            <PendingSubmitButton
              pendingText="Bezig met ophalen — dit duurt even…"
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink"
            >
              Prijzen nu verversen
            </PendingSubmitButton>
            {/* Eerlijk over wat de knop wél en niet doet. */}
            <p className="mt-1 text-xs text-ink-faint">
              Haalt de prijzen van een deel van je ingrediënten op, zodat je meteen ziet of het werkt.
              De volledige lijst gaat elke nacht vanzelf.
            </p>
          </form>
        </section>

        {comparison.lines.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface p-4 text-sm text-ink-muted">
            Er staat nog niets op je boodschappenlijst om door te rekenen.
          </p>
        ) : (
          <>
            {/* De drie winkels naast elkaar, zodat het verschil in één
                oogopslag te zien is. De regels waarover elk bedrag gaat staan
                er per winkel bij: AH en Dirk hebben niet allebei evenveel van
                je lijst, en dan zijn twee kale totalen niet vergelijkbaar. */}
            <section className="mb-6 overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full min-w-[20rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="px-3 py-2 font-medium text-ink-muted">Hele lijst</th>
                    {columns.map((provider) => (
                      <th key={provider} className="px-3 py-2 text-right font-medium text-ink">
                        {PROVIDER_LABELS[provider]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  <tr className="border-b border-line">
                    <td className="px-3 py-2 text-ink-muted">
                      Hetzelfde of gelijkwaardig
                    </td>
                    {columns.map((provider) => {
                      if (provider === "PICNIC") {
                        return (
                          <td key={provider} className="px-3 py-2 text-right text-base font-semibold text-ink">
                            {euro(comparison.referenceTotal)}
                          </td>
                        );
                      }
                      const total = comparison.totals.get(provider);
                      return (
                        <td key={provider} className="px-3 py-2 text-right text-base font-semibold text-ink">
                          {total && total.linesCompared > 0 ? euro(total.hardTotal) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="border-b border-line text-xs text-ink-faint">
                    <td className="px-3 py-2">Over hoeveel regels</td>
                    {columns.map((provider) => {
                      if (provider === "PICNIC") {
                        return (
                          <td key={provider} className="px-3 py-2 text-right">
                            {comparison.lines.length} van de {comparison.lines.length}
                          </td>
                        );
                      }
                      const total = comparison.totals.get(provider);
                      return (
                        <td key={provider} className="px-3 py-2 text-right">
                          {total ? `${total.linesCompared} van de ${comparison.lines.length}` : "—"}
                        </td>
                      );
                    })}
                  </tr>
                  {/* Het eerlijke vergelijkingspunt: wat Picnic kost over
                      precies dezelfde regels als die winkel kon leveren. */}
                  <tr className="border-b border-line text-xs text-ink-faint">
                    <td className="px-3 py-2">Bij Picnic, dezelfde regels</td>
                    {columns.map((provider) => {
                      if (provider === "PICNIC") return <td key={provider} className="px-3 py-2" />;
                      const total = comparison.totals.get(provider);
                      if (!total || total.linesCompared === 0) {
                        return (
                          <td key={provider} className="px-3 py-2 text-right">
                            —
                          </td>
                        );
                      }
                      const difference = describeDifference(
                        total.hardTotal,
                        total.referenceTotalForHardLines,
                        total.linesCompared
                      );
                      return (
                        <td key={provider} className="px-3 py-2 text-right">
                          {euro(total.referenceTotalForHardLines)}
                          {difference ? <span className="block text-ink-muted">{difference}</span> : null}
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="text-xs text-ink-faint">
                    <td className="px-3 py-2">Met alternatieven erbij</td>
                    {columns.map((provider) => {
                      if (provider === "PICNIC") return <td key={provider} className="px-3 py-2" />;
                      const total = comparison.totals.get(provider);
                      return (
                        <td key={provider} className="px-3 py-2 text-right">
                          {total && total.linesWithAlternative > 0 ? euro(total.alternativeTotal) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>

              <div className="space-y-1 border-t border-line px-3 py-3">
                {providers.map((provider) => {
                  const total = comparison.totals.get(provider);
                  if (!total) return null;
                  const source = describeProviderSource(provider);
                  const label = PROVIDER_LABELS[provider];
                  // Of we van deze winkel überhaupt een prijs hebben, los van de
                  // vraag of er iets vergelijkbaars bij zat.
                  // De reden wordt uit de regels zelf afgeleid, niet
                  // aangenomen: het scherm mag nooit iets beweren dat de
                  // regels eronder tegenspreken.
                  const uncomparable = describeUncomparableStore(comparison.lines, provider, label);
                  return (
                    <div key={provider} className="text-xs text-ink-faint">
                      {uncomparable ? (
                        <p className="flex items-start gap-1.5 text-ink-muted">
                          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-tag-amber-ink" />
                          <span>{uncomparable}</span>
                        </p>
                      ) : (
                        total.linesMissing > 0 && (
                          <p className="flex items-start gap-1.5">
                            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-tag-amber-ink" />
                            <span>
                              {`${label}: ${total.linesMissing} ${
                                total.linesMissing === 1 ? "regel telt" : "regels tellen"
                              } niet mee, dus dit is geen prijs voor je hele lijst.`}
                            </span>
                          </p>
                        )
                      )}
                      {source && <p>{`${label}: ${source}.`}</p>}
                      {total.anyStale && total.oldestObservation && (
                        <p>
                          {PROVIDER_LABELS[provider]}: oudste prijs van{" "}
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
                {comparison.referenceLinesMissing > 0 && (
                  <p className="text-xs text-ink-faint">
                    Van {comparison.referenceLinesMissing}{" "}
                    {comparison.referenceLinesMissing === 1 ? "regel" : "regels"} weten we de Picnic-prijs
                    nog niet.
                  </p>
                )}

              </div>
            </section>

            {/* Splitsingsadvies verschijnt alleen boven de drempel: een advies
                dat elke week met € 0,40 komt, leert de gebruiker het te
                negeren. */}
            {overview.splitAdvice.map((advice) => (
              <section
                key={advice.provider}
                className="mb-6 rounded-xl border border-line bg-surface-2 p-4"
              >
                <p className="text-sm font-medium text-ink">
                  {describeSplitAdvice(advice, PROVIDER_LABELS[advice.provider])}
                </p>
                <ul className="mt-2 space-y-1">
                  {advice.items.slice(0, 8).map((item) => (
                    <li key={item.lineId} className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate text-ink-muted">
                        {item.ingredientName} — {item.productName}
                      </span>
                      <span className="shrink-0 text-ink">
                        {euro(item.storeCost)} <span className="text-ink-faint">i.p.v. {euro(item.ownCost)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {overview.stockUpAdvice.length > 0 && (
              <section className="mb-6 rounded-xl border border-line bg-surface-2 p-4">
                <p className="text-sm font-medium text-ink">Hier zou je nu extra van kunnen kopen</p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  Alleen dingen die lang goed blijven, en nooit meer dan een paar — een kast vol dat over
                  de datum gaat is de duurste besparing die er is.
                </p>
                <ul className="mt-2 space-y-1">
                  {overview.stockUpAdvice.slice(0, 4).map((item) => (
                    <li key={`${item.ingredientName}-${item.productName}`} className="text-xs">
                      <span className="text-ink">
                        {item.extraPackages}× extra {item.ingredientName.toLowerCase()}
                      </span>{" "}
                      <span className="text-ink-faint">
                        scheelt {euro(item.saving)} — {item.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

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
                    {/* De kern van dit scherm: dezelfde regel bij alle drie de
                        winkels naast elkaar. De goedkoopste krijgt nadruk —
                        maar alleen als hij ook echt vergelijkbaar is, want
                        goedkoper door iets anders te kopen is geen besparing. */}
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {compareLineAcrossStores(line, providers).map((cell) => (
                        <div
                          key={cell.provider}
                          data-store-cell={cell.provider}
                          className={`rounded-lg border p-2 ${
                            cell.cheapest ? "border-tag-green-ink/40 bg-tag-green-bg" : "border-line bg-surface-2"
                          }`}
                        >
                          <div className="flex items-baseline justify-between gap-1">
                            <p className="truncate text-[11px] font-medium text-ink-muted">
                              {PROVIDER_LABELS[cell.provider]}
                            </p>
                            {/* Zichtbaar in het overzicht zelf, niet pas na
                                uitklappen. Een nep-korting krijgt geen
                                markering — zie `showsPromotion`. */}
                            {showsPromotion(cell) && (
                              <span className="shrink-0 rounded bg-tag-green-bg px-1 text-[10px] font-semibold text-tag-green-ink">
                                Actie
                              </span>
                            )}
                          </div>
                          <p
                            className={`tabular-nums text-sm font-semibold ${
                              cell.cheapest ? "text-tag-green-ink" : "text-ink"
                            }`}
                          >
                            {cell.cost !== null ? euro(cell.cost) : "—"}
                          </p>
                          {/* Welk product dit dan is — met de link erachter waar
                              we die kennen, zodat je zelf kunt nakijken of het
                              echt hetzelfde is. Picnic heeft geen publieke
                              productpagina; daar staat dus alleen de naam. */}
                          {cell.productName &&
                            (cell.productUrl ? (
                              <a
                                href={cell.productUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="flex items-center gap-0.5 text-[11px] text-accent underline"
                              >
                                <span className="truncate">{cell.productName}</span>
                                <ExternalLink size={9} className="shrink-0" />
                              </a>
                            ) : (
                              <p className="truncate text-[11px] text-ink-muted">{cell.productName}</p>
                            ))}
                          {cell.cost !== null && cell.packagesToBuy !== null && (
                            <p className="text-[11px] text-ink-faint">
                              {cell.packagesToBuy}×{cell.packageSize ? ` ${cell.packageSize}` : ""}
                            </p>
                          )}
                          {/* Het enige getal dat over verpakkingsgroottes heen
                              vergelijkt: €/liter of €/kilo. */}
                          {cell.unitPriceLabel && (
                            <p className="text-[11px] text-ink-faint">{cell.unitPriceLabel}</p>
                          )}
                          {showsPromotion(cell) && (
                            <p className="text-[11px] text-tag-green-ink">{cell.promoLabel}</p>
                          )}
                          {cell.note && <p className="text-[11px] text-ink-faint">{cell.note}</p>}
                        </div>
                      ))}
                    </div>

                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-medium text-accent">
                        Welke producten, en aanpassen
                      </summary>
                      <p className="mt-2 text-xs text-ink-faint">
                        Picnic:{" "}
                        {line.referenceName
                          ? [
                              line.referenceName,
                              line.referenceBrand,
                              line.referencePackageSize,
                              formatUnitPrice(
                                line.referenceUnitPrice !== null && line.referenceUnitPriceUnit !== null
                                  ? {
                                      amount: line.referenceUnitPrice,
                                      unit: line.referenceUnitPriceUnit,
                                    }
                                  : null
                              ),
                              line.referenceCost !== null
                                ? `${line.referencePackages}x · ${euro(line.referenceCost)}`
                                : "prijs onbekend",
                            ]
                              .filter((part) => part !== null && part !== "")
                              .join(" · ")
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
                                {store.brand ? ` · ${store.brand}` : ""}
                                {store.packageSize ? ` · ${store.packageSize}` : ""}
                                {store.packagesToBuy !== null ? ` · ${store.packagesToBuy}x` : ""}
                              </p>
                              {/* €/liter of €/kilo: het enige getal waarmee een
                                  pak van 500 ml en een pak van 1 l eerlijk
                                  naast elkaar staan. */}
                              {store.unitPrice !== null && store.unitPriceUnit !== null && (
                                <p className="text-xs text-ink-faint">
                                  {formatUnitPrice({
                                    amount: store.unitPrice,
                                    unit: store.unitPriceUnit,
                                  })}
                                </p>
                              )}
                              {/* De link naar de winkel zelf: de app zegt
                                  "gelijkwaardig", deze pagina laat het je
                                  nakijken. */}
                              {store.productUrl && (
                                <a
                                  href={store.productUrl}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-accent underline"
                                >
                                  Bekijk bij {PROVIDER_LABELS[provider]}
                                  <ExternalLink size={11} />
                                </a>
                              )}
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
                                <p className="mt-0.5 text-xs text-tag-green-ink">
                                  {store.promoLabel}
                                  {/* Wat de actie hier concreet doet. "1+1 gratis"
                                      is bij drie stuks 33% korting, niet 50% — en
                                      bij één stuk helemaal geen. */}
                                  {store.promoExplanation ? ` · ${store.promoExplanation}` : ""}
                                  {store.costWithoutPromo !== null &&
                                  store.cost !== null &&
                                  store.costWithoutPromo > store.cost
                                    ? ` · zonder actie ${euro(store.costWithoutPromo)}`
                                    : ""}
                                  {/* Tot wanneer je erop kunt rekenen. Alleen als
                                      de winkel het meegeeft — een verzonnen
                                      einddatum is erger dan geen. */}
                                  {store.promoUntil ? ` · t/m ${formatDay(store.promoUntil)}` : ""}
                                </p>
                              )}
                              {store.fakeDiscount && (
                                <p className="mt-0.5 text-xs text-tag-amber-ink">
                                  Let op: die van-prijs is hier de afgelopen weken niet gerekend. Dit is
                                  gewoon de normale prijs.
                                </p>
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

                          {/* Bewust niet nog een uitklapniveau: wie "welke
                              producten" opent, wil de alternatieven meteen
                              zien in plaats van er nog een keer voor te
                              klikken. */}
                          {candidates.length > 1 && (
                            <div className="mt-2 border-t border-line pt-2">
                              <p className="text-xs font-medium text-ink-muted">Ander product kiezen</p>
                              <div className="mt-1 space-y-1">
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
                            </div>
                          )}
                        </div>
                      );
                    })}
                    </details>
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
  const unitPriceLabel = formatUnitPrice(
    candidate.unitPrice !== null && candidate.unitPriceUnit !== null
      ? { amount: candidate.unitPrice, unit: candidate.unitPriceUnit }
      : null
  );

  return (
    <form action={chooseStoreProduct} className="flex items-center justify-between gap-3">
      <input type="hidden" name="ingredientId" value={ingredientId} />
      <input type="hidden" name="productId" value={candidate.productId} />
      <input type="hidden" name="provider" value={candidate.provider satisfies ProductProvider} />
      <input type="hidden" name="lineId" value={lineId} />
      <span className="min-w-0 text-xs text-ink-muted">
        <span className="block truncate">
          {candidate.name}
          {candidate.brand ? ` · ${candidate.brand}` : ""}
          {candidate.packageSize ? ` · ${candidate.packageSize}` : ""} · {euro(candidate.price)}
          {/* Bewust géén actielabel hier. De kiezer weet niet of de van-prijs
              volgens de geschiedenis klopt — dat oordeel komt uit de
              doorrekening. Anders zou hetzelfde product hierboven "let op:
              die van-prijs is niet gerekend" krijgen en twee regels lager
              alsnog "van 4,99 voor 3,87" als verkoopargument. */}
        </span>
        <span className="block truncate text-ink-faint">
          {unitPriceLabel}
          {/* De link staat bij elk alternatief, niet alleen bij het gekozen
              product: juist bij het kiezen wil je kunnen nakijken wat het is. */}
          {candidate.productUrl && (
            <>
              {unitPriceLabel ? " · " : ""}
              <a
                href={candidate.productUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent underline"
              >
                bekijken
              </a>
            </>
          )}
        </span>
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
