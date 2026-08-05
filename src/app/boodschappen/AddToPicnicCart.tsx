"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { addToPicnicCart, clearPicnicCart, confirmPicnicOrder, getPicnicConfirmationSummary } from "./actions";
import type { PicnicCartResult } from "@/lib/picnic/cartService";
import type { ConfirmationSummary } from "@/lib/picnic/confirmationSummary";

type Stage = "idle" | "confirming" | "done";
type TransferScope = "all" | "fixed";

function formatPrice(amount: number) {
  return `€ ${amount.toFixed(2)}`;
}

export default function AddToPicnicCart({
  shoppingListId,
  connected,
  hasTransferredLines,
  orderConfirmed,
  quickOrderCount,
}: {
  shoppingListId: string;
  connected: boolean;
  hasTransferredLines: boolean;
  orderConfirmed: boolean;
  /** Aantal nog niet overgedragen vaste-boodschappen/losse-toevoegingen — bepaalt of de "alleen vaste boodschappen"-knop zin heeft. */
  quickOrderCount: number;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [scope, setScope] = useState<TransferScope>("all");
  const [summary, setSummary] = useState<ConfirmationSummary | null>(null);
  const [result, setResult] = useState<PicnicCartResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
  const [isClearPending, startClearTransition] = useTransition();

  const [isConfirmOrderPending, startConfirmOrderTransition] = useTransition();
  const [orderConfirmError, setOrderConfirmError] = useState<string | null>(null);

  function handleConfirmOrder() {
    setOrderConfirmError(null);
    startConfirmOrderTransition(async () => {
      try {
        await confirmPicnicOrder(shoppingListId);
      } catch (e) {
        setOrderConfirmError(e instanceof Error ? e.message : "Er ging iets mis.");
      }
    });
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
        await clearPicnicCart(shoppingListId);
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

  return (
    <div className="mt-4 min-w-0">
      {stage === "idle" && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => handleOpenConfirmation("all")}
            disabled={isPending}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
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
              {isPending && scope === "fixed"
                ? "Bezig…"
                : `Vaste boodschappen + losse toevoegingen (${quickOrderCount})`}
            </button>
          )}
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
          <p className="mb-1 text-xs text-ink-muted">
            Verwachte totaalprijs: {summary.unknownPriceCount > 0 ? "minstens " : ""}
            {formatPrice(summary.expectedTotalPrice)}
            {summary.unknownPriceCount > 0 &&
              ` (${summary.unknownPriceCount} product(en) zonder bekende prijs)`}
          </p>
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
          <div className="mt-3 flex flex-wrap gap-2">
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
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {stage === "done" && result && (
        <div className="mt-3 min-w-0 rounded-lg border border-line p-3 text-xs">
          <p className="font-medium text-tag-green-ink">
            {result.added.reduce((sum, item) => sum + item.count, 0)} verpakking(en) toegevoegd aan je Picnic-mandje.
          </p>
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
              Fout bij: {result.errors.map((e) => e.ingredientName).join(", ")}.
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

      {hasTransferredLines && !orderConfirmed && (
        <div className="mt-4 min-w-0 rounded-lg border border-accent/35 bg-accent-soft p-3 text-xs">
          <p className="mb-2 font-medium text-ink">Rond je bestelling af in Picnic.</p>
          <p className="mb-2 text-ink-muted">
            De producten staan in je Picnic-mandje. Ik weet niet zeker of je al hebt afgerekend —
            open Picnic om de bestelling te plaatsen.
          </p>
          <button
            type="button"
            onClick={handleConfirmOrder}
            disabled={isConfirmOrderPending}
            className="rounded-lg border border-line px-3 py-1.5 font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
          >
            {isConfirmOrderPending ? "Bezig…" : "Ik heb besteld"}
          </button>
          {orderConfirmError && <p className="mt-2 text-red-600">{orderConfirmError}</p>}
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
