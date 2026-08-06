"use client";

import { useState } from "react";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import { startLooseShoppingList } from "./looseListActions";

export default function LooseListCard({
  householdId,
  weekStart,
  hasTransferredLines,
}: {
  householdId: string;
  /** ISO-datum van de week zoals de pagina 'm nu toont — voorkomt dat de actie bij een aanvraag rond middernacht een andere (nog niet bestaande) week pakt dan de gebruiker zag. */
  weekStart: string;
  /** Staat er al iets van deze week in het echte Picnic-mandje? Dan verliest deze actie de idempotentie-vlag die dubbel toevoegen voorkomt — expliciet waarschuwen. */
  hasTransferredLines: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div id="loose-list" className="mb-6 min-w-0 scroll-mt-6 rounded-xl border border-line bg-surface p-4">
      <h2 className="mb-1 text-sm font-semibold text-ink">Losse boodschappenlijst starten</h2>
      <p className="mb-3 text-xs text-ink-muted">
        Los van het weekmenu van vanavond — voor als je gewoon standaard boodschappen wilt samenstellen.
        Je vaste boodschappen staan meteen klaar; de rest voeg je zelf toe.
      </p>

      {!confirming && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="w-full rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
        >
          Losse boodschappenlijst starten
        </button>
      )}

      {confirming && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs">
          <p className="mb-2 text-red-700">
            Dit vervangt de boodschappenlijst van deze week door een lege lijst, los van het weekmenu.
            Vaste boodschappen komen automatisch terug — de weekmenu-regels verdwijnen. Dit kan niet
            ongedaan worden gemaakt.
          </p>
          <p className="mb-3 text-ink-muted">
            Dit verandert alleen de lijst in Family Assistant. Staat er al iets in je echte
            Picnic-mandje? Dat blijft gewoon staan — leeg dat apart met &ldquo;Picnic-mandje legen&rdquo;.
          </p>
          {hasTransferredLines && (
            <p className="mb-3 rounded-md bg-tag-amber-bg px-2.5 py-2 text-tag-amber-ink">
              Je hebt deze week al producten naar je Picnic-mandje overgedragen. Die blijven op de
              lijst staan — ze liggen immers al in je mandje — en worden niet nog een keer besteld.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <form action={startLooseShoppingList}>
              <input type="hidden" name="householdId" value={householdId} />
              <input type="hidden" name="weekStart" value={weekStart} />
              <PendingSubmitButton
                pendingText="Bezig..."
                className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:opacity-90"
              >
                Ja, losse lijst starten
              </PendingSubmitButton>
            </form>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-line px-3 py-1.5 font-medium text-ink hover:bg-surface-2"
            >
              Annuleren
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
