"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { addToPicnicCart, clearPicnicCart, confirmPicnicOrder, getPicnicConfirmationSummary } from "./actions";
import type { PicnicCartResult } from "@/lib/picnic/cartService";
import type { PicnicConfirmationDetails } from "./actions";

type Stage = "idle" | "confirming" | "done";
type TransferScope = "all" | "fixed";

function formatPrice(amount: number) {
  return `€ ${amount.toFixed(2)}`;
}

/**
 * De verse bezorgcontrole op het laatste moment vóór het mandje vullen.
 *
 * De pagina haalt de bezorgmomenten al op bij het laden, maar een scherm dat
 * even openstaat is een momentopname — en dit is het laatste punt waarop de
 * gebruiker nog kan besluiten te wachten. Blokkeert nooit: het mandje vullen
 * is iets anders dan een bezorgmoment vastleggen, en dat laatste doet de app
 * sowieso niet.
 */
function DeliveryCheckNote({
  delivery,
  summary,
}: {
  delivery: NonNullable<PicnicConfirmationDetails["delivery"]>;
  summary: PicnicConfirmationDetails;
}) {
  const amber = "mb-2 rounded-md bg-tag-amber-bg px-2.5 py-2 text-xs text-tag-amber-ink";
  const green = "mb-2 rounded-md bg-tag-green-bg px-2.5 py-2 text-xs text-tag-green-ink";

  if (delivery.error) {
    return (
      <p className={amber}>
        {delivery.error === "auth"
          ? "Ik kon de bezorgmomenten net niet controleren — je Picnic-sessie is verlopen."
          : "Ik kon de bezorgmomenten net niet controleren."}{" "}
        Je mandje vullen kan gewoon.
      </p>
    );
  }

  if (delivery.days.length === 0) {
    return (
      <p className={amber}>
        Picnic heeft op dit moment geen vrij bezorgmoment. Je mandje vullen kan wel — je kiest je moment straks in de
        Picnic-app.
      </p>
    );
  }

  // Een oordeel over de minimale bestelwaarde alleen als we het echt weten:
  // met onbekende prijzen is het totaal een ondergrens, en producten die al in
  // het mandje liggen tellen wél mee voor Picnic maar niet in dit bedrag.
  const canJudgeMinimum =
    delivery.minimumOrderValue !== null && summary.unknownPriceCount === 0 && summary.alreadyTransferredCount === 0;

  return (
    <>
      <p className={green}>
        Net gecheckt bij Picnic:{" "}
        {delivery.days.map((day) => `${day.label} ${day.windows.join(", ")}`).join(" · ")} {delivery.days.length === 1 ? "is" : "zijn"}{" "}
        nog vrij.
      </p>
      {delivery.minimumOrderValue !== null &&
        (canJudgeMinimum ? (
          summary.expectedTotalPrice < delivery.minimumOrderValue ? (
            <p className={amber}>
              Je zit met {formatPrice(summary.expectedTotalPrice)} nog onder de minimale bestelwaarde van{" "}
              {formatPrice(delivery.minimumOrderValue)}.
            </p>
          ) : (
            <p className="mb-2 text-xs text-ink-muted">
              Boven de minimale bestelwaarde van {formatPrice(delivery.minimumOrderValue)}.
            </p>
          )
        ) : (
          <p className="mb-2 text-xs text-ink-muted">
            Minimale bestelwaarde bij Picnic: {formatPrice(delivery.minimumOrderValue)}.
          </p>
        ))}
    </>
  );
}

export default function AddToPicnicCart({
  shoppingListId,
  connected,
  hasTransferredLines,
  orderConfirmed,
  fixedCount,
  manualCount,
}: {
  shoppingListId: string;
  connected: boolean;
  hasTransferredLines: boolean;
  orderConfirmed: boolean;
  /** Aantal nog niet overgedragen vaste boodschappen — apart van manualCount zodat de knoptekst niet één dubbelzinnig totaal toont. */
  fixedCount: number;
  /** Aantal nog niet overgedragen losse toevoegingen. */
  manualCount: number;
}) {
  const quickOrderCount = fixedCount + manualCount;
  const [stage, setStage] = useState<Stage>("idle");
  const [scope, setScope] = useState<TransferScope>("all");
  const [summary, setSummary] = useState<PicnicConfirmationDetails | null>(null);
  const [result, setResult] = useState<PicnicCartResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
  const [isClearPending, startClearTransition] = useTransition();

  const [isConfirmOrderPending, setIsConfirmOrderPending] = useState(false);
  const [orderConfirmError, setOrderConfirmError] = useState<string | null>(null);
  const [orderConfirmedLocally, setOrderConfirmedLocally] = useState(false);

  // Bewust GEEN useTransition hier (in tegenstelling tot de andere acties in
  // dit component): confirmPicnicOrder revalideert zowel "/boodschappen" als
  // "/", en sinds dit component ook rechtstreeks op "/" zelf gerenderd wordt
  // (bestel-nu vanaf de startpagina), zorgde de transition-gebonden "patch de
  // huidige route direct bij" van Next ervoor dat de knop op ~50% van de
  // kliks voor altijd op "Bezig…" bleef staan terwijl de database-update wel
  // gewoon lukte — reproduceerbaar bevestigd via onafhankelijke review. Los
  // bijgehouden pending-state + lokale bevestiging omzeilt dat pad volledig.
  function handleConfirmOrder() {
    setOrderConfirmError(null);
    setIsConfirmOrderPending(true);
    confirmPicnicOrder(shoppingListId)
      .then(() => setOrderConfirmedLocally(true))
      .catch((e) => setOrderConfirmError(e instanceof Error ? e.message : "Er ging iets mis."))
      .finally(() => setIsConfirmOrderPending(false));
  }

  function handleOpenConfirmation(nextScope: TransferScope) {
    setScope(nextScope);
    setError(null);
    startTransition(async () => {
      try {
        const s = await getPicnicConfirmationSummary(shoppingListId, nextScope);
        setSummary(s);
        setStage("confirming");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Er ging iets mis.");
      }
    });
  }

  function handleConfirmAdd() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await addToPicnicCart(shoppingListId, scope);
        setResult(res);
        setCleared(false);
        setStage("done");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Er ging iets mis.");
      }
    });
  }

  function handleClearCart() {
    setClearError(null);
    startClearTransition(async () => {
      try {
        const result = await clearPicnicCart(shoppingListId);
        if (!result.ok) {
          setClearError(result.message);
          return;
        }
        setCleared(true);
        setConfirmingClear(false);
        setStage("idle");
        setSummary(null);
        setResult(null);
      } catch (e) {
        setClearError(e instanceof Error ? e.message : "Er ging iets mis.");
      }
    });
  }

  if (!connected) {
    return (
      <div className="mt-4 min-w-0 rounded-lg bg-surface-2 p-3 text-xs text-ink-muted">
        Nog geen Picnic-account gekoppeld.{" "}
        <Link href="/ons-gezin" className="font-medium text-accent underline decoration-dotted">
          Koppel je account bij Ons gezin
        </Link>{" "}
        om deze knop te activeren.
      </div>
    );
  }

  function quickOrderButtonLabel() {
    if (fixedCount > 0 && manualCount > 0) {
      return `Vaste boodschappen (${fixedCount}) + losse toevoegingen (${manualCount})`;
    }
    if (fixedCount > 0) return `Vaste boodschappen (${fixedCount})`;
    return `Losse toevoegingen (${manualCount})`;
  }

  // Zodra het mandje gevuld is maar de bestelling nog niet is afgerond, ís
  // "Ik heb besteld" de volgende stap — dat blok komt dan bovenaan en krijgt
  // de accentknop, en "Toevoegen aan Picnic-mandje" wordt visueel secundair
  // (UX-review: een haastige tik op de prominente knop riskeerde dubbel
  // toevoegen, terwijl de eigenlijke vervolgstap een klein randknopje was).
  const awaitingOrderConfirm = hasTransferredLines && !orderConfirmed && !orderConfirmedLocally;

  return (
    <div className="mt-4 min-w-0">
      {awaitingOrderConfirm && (
        <div className="mb-4 min-w-0 rounded-lg border border-accent/35 bg-accent-soft p-3 text-xs">
          <p className="mb-2 font-medium text-ink">Rond je bestelling af in Picnic.</p>
          <p className="mb-2 text-ink-muted">
            De producten staan in je Picnic-mandje. Ik weet niet zeker of je al hebt afgerekend —
            open Picnic om de bestelling te plaatsen.
          </p>
          <button
            type="button"
            onClick={handleConfirmOrder}
            disabled={isConfirmOrderPending}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isConfirmOrderPending ? "Bezig…" : "Ik heb besteld"}
          </button>
          {orderConfirmError && <p className="mt-2 text-red-600">{orderConfirmError}</p>}
        </div>
      )}

      {stage === "idle" && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => handleOpenConfirmation("all")}
            disabled={isPending}
            className={
              awaitingOrderConfirm
                ? "w-full rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
                : "w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            }
          >
            {isPending && scope === "all" ? "Bezig…" : "Toevoegen aan Picnic-mandje"}
          </button>
          {quickOrderCount > 0 && (
            <button
              type="button"
              onClick={() => handleOpenConfirmation("fixed")}
              disabled={isPending}
              className="w-full rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {isPending && scope === "fixed" ? "Bezig…" : quickOrderButtonLabel()}
            </button>
          )}
          <Link
            href="/boodschappen#jullie-boodschappenlijst"
            className="text-center text-xs font-medium text-ink-faint underline decoration-dotted hover:text-ink"
          >
            Bekijk de volledige lijst
          </Link>
        </div>
      )}

      {stage === "confirming" && summary && (
        <div className="min-w-0 rounded-lg border border-line p-4 text-sm">
          <p className="mb-2 font-medium text-ink">
            {summary.toTransferCount}{" "}
            {scope === "fixed" ? "vaste boodschap(pen) en losse toevoegingen" : "product(en)"} worden toegevoegd aan
            je Picnic-mandje.
          </p>
          {scope === "fixed" && (
            <p className="mb-2 text-xs text-ink-muted">
              Weekmenu-producten worden hierbij niet meegenomen — gebruik &quot;Toevoegen aan Picnic-mandje&quot; als je
              ook die wilt bestellen.
            </p>
          )}
          {summary.alreadyTransferredCount > 0 && (
            <p className="mb-1 text-xs text-ink-faint">
              {summary.alreadyTransferredCount} product(en) staan al in het mandje en worden overgeslagen.
            </p>
          )}
          {/* Geen enkel getal zonder herkomst: de gebruiker moet kunnen zien
              waaruit die "N producten" bestaat. */}
          <ul className="mb-2 flex flex-col gap-0.5 text-xs text-ink-muted">
            {(
              [
                ["FIXED", "Vaste boodschappen"],
                ["MANUAL", "Zelf toegevoegd"],
                ["MEAL", "Voor het avondeten"],
                ["INVENTORY", "Voorraad aanvullen"],
              ] as const
            )
              .filter(([source]) => summary.toTransferBySource[source] > 0)
              .map(([source, label]) => (
                <li key={source} className="flex justify-between gap-3">
                  <span>{label}</span>
                  <span className="font-medium tabular-nums text-ink">{summary.toTransferBySource[source]}</span>
                </li>
              ))}
          </ul>
          <p className="mb-1 text-xs text-ink-muted">
            Verwachte totaalprijs: {summary.unknownPriceCount > 0 ? "minstens " : ""}
            {formatPrice(summary.expectedTotalPrice)}
            {summary.unknownPriceCount > 0 &&
              ` (${summary.unknownPriceCount} product(en) zonder bekende prijs)`}
          </p>
          {summary.delivery && <DeliveryCheckNote delivery={summary.delivery} summary={summary} />}
          {summary.oldestPriceCheck && (
            <p className="mb-2 text-xs text-ink-faint">
              Prijzen laatst gecontroleerd op {summary.oldestPriceCheck.toLocaleDateString("nl-NL")}.
            </p>
          )}
          {summary.manuallySelected.length > 0 && (
            <p className="mb-1 text-xs text-tag-amber-ink">
              Handmatig aangepast: {summary.manuallySelected.join(", ")}.
            </p>
          )}
          {summary.unavailable.length > 0 && (
            <p className="mb-2 text-xs text-tag-amber-ink">
              Niet gevonden bij Picnic (worden overgeslagen): {summary.unavailable.join(", ")}.
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleConfirmAdd}
              disabled={isPending}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? "Bezig met toevoegen…" : "Ja, voeg toe aan mandje"}
            </button>
            <button
              type="button"
              onClick={() => setStage("idle")}
              disabled={isPending}
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2"
            >
              Annuleren
            </button>
            <Link
              href="/boodschappen#jullie-boodschappenlijst"
              className="text-xs font-medium text-ink-faint underline decoration-dotted hover:text-ink"
            >
              Eerst de lijst bekijken/wijzigen
            </Link>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {stage === "done" && result && (
        <div className="mt-3 min-w-0 rounded-lg border border-line p-3 text-xs">
          {result.added.length > 0 && (
            <p className="font-medium text-tag-green-ink">
              {result.added.reduce((sum, item) => sum + item.count, 0)} verpakking(en) toegevoegd aan je Picnic-mandje.
            </p>
          )}
          {result.skipped.length > 0 && (
            <p className="mt-1 text-ink-faint">
              {result.skipped.length} product(en) stonden al in het mandje.
            </p>
          )}
          {result.notFound.length > 0 && (
            <p className="mt-1 text-tag-amber-ink">
              Niet gevonden bij Picnic: {result.notFound.join(", ")} — voeg deze zelf toe.
            </p>
          )}
          {result.errors.length > 0 && (
            <p className="mt-1 text-red-600">
              {result.errors
                .map((e) => (e.ingredientName ? `${e.ingredientName}: ${e.message}` : e.message))
                .join(" ")}
              {result.stoppedEarly && " De rest is niet geprobeerd — probeer het later opnieuw."}
            </p>
          )}
          {(result.notFound.length > 0 || result.errors.length > 0) && (
            <button
              type="button"
              onClick={() => setStage("idle")}
              className="mt-2 text-xs font-medium text-accent underline decoration-dotted"
            >
              Opnieuw proberen
            </button>
          )}
        </div>
      )}

      <div className="mt-4 border-t border-line pt-3">
        {!confirmingClear ? (
          <button
            type="button"
            onClick={() => setConfirmingClear(true)}
            className="text-xs font-medium text-ink-faint underline decoration-dotted hover:text-red-600"
          >
            Picnic-mandje legen
          </button>
        ) : (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs">
            <p className="mb-2 text-red-700">
              Weet je zeker dat je het hele Picnic-mandje wilt legen? Dit kan niet ongedaan worden gemaakt.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleClearCart}
                disabled={isClearPending}
                className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {isClearPending ? "Bezig…" : "Ja, mandje legen"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingClear(false)}
                disabled={isClearPending}
                className="rounded-md border border-line px-3 py-1.5 font-medium text-ink hover:bg-surface-2"
              >
                Annuleren
              </button>
            </div>
          </div>
        )}
        {cleared && <p className="mt-2 text-tag-green-ink">Mandje geleegd.</p>}
        {clearError && <p className="mt-2 text-red-600">{clearError}</p>}
      </div>
    </div>
  );
}
