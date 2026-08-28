"use client";

import { useState } from "react";
import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { confirmPicnicOrder } from "./actions";

/**
 * "Je Picnic-mandje is leeg — heb je besteld?"
 *
 * De app kan niet zíen of er afgerekend is; dat gebeurt in de Picnic-app.
 * Wat ze wel kan: constateren dat het mandje leeg is terwijl zij er producten
 * in heeft gelegd. Dat is een sterke aanwijzing, maar geen bewijs — je kunt
 * het mandje ook elders geleegd hebben. Daarom een vraag en geen conclusie.
 *
 * Zonder deze vraag bleef de oranje "rond je bestelling af"-kaart staan tot
 * de gebruiker er zelf aan dacht, soms dagenlang.
 */
export default function OrderPlacedQuestion({ shoppingListId }: { shoppingListId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mb-4 min-w-0 rounded-xl border border-accent bg-accent-soft p-3 text-xs">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <ShoppingCart size={15} />
        Je Picnic-mandje is leeg — heb je besteld?
      </p>
      <p className="mt-1 text-ink-muted">
        Ik heb er producten in gelegd en nu is het leeg. Meestal betekent dat: besteld.
      </p>

      {error && <p className="mt-2 rounded-md bg-tag-amber-bg px-2.5 py-2 text-tag-amber-ink">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError(null);
            try {
              await confirmPicnicOrder(shoppingListId);
            } catch {
              setError("Dat lukte niet. Probeer het zo nog eens.");
              setPending(false);
            }
          }}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Bezig…" : "Ja, besteld"}
        </button>
        {/* Bewust alleen deze weergave overslaan: de markeringen "ligt al in
            je mandje" blijven staan. Die weghalen op basis van één leesactie
            zou betekenen dat een volgende overdracht alles opnieuw bestelt —
            wil je écht opnieuw beginnen, dan is "Picnic-mandje legen" de
            bedoelde weg. */}
        <Link
          href="/boodschappen?bestelvraag=later#bezorgmomenten"
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2"
        >
          Nee, nog niet
        </Link>
      </div>
    </div>
  );
}
