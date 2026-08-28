"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";

/**
 * Haalt de pagina opnieuw op bij de server, zodat de bezorgmomenten vers bij
 * Picnic worden opgevraagd. Dat werkt omdat elke pagina `force-dynamic` is en
 * de Picnic-aanroepen nergens gecached worden — een refresh is dus echt een
 * nieuwe vraag aan Picnic, geen opgeslagen kopie.
 */
export default function DeliverySlotsRefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
      aria-label="Bezorgmomenten opnieuw ophalen bij Picnic"
      className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:bg-surface-2 disabled:opacity-60"
    >
      <RotateCw size={12} className={pending ? "animate-spin" : undefined} />
      {pending ? "Bezig..." : "Ververs"}
    </button>
  );
}
