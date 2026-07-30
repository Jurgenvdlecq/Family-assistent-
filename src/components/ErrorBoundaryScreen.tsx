"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Gedeeld door alle `error.tsx`-boundaries (Fase 16): meldt de fout één keer
 * bij het tonen van dit scherm aan `/api/log/client-error`, zodat hij ook
 * terugvindbaar is in de gestructureerde server-logging — niet alleen als
 * generieke browserfout. Fire-and-forget: als loggen zelf mislukt (bijv.
 * geen netwerk) mag dat de foutpagina zelf nooit blokkeren of vertragen.
 */
export default function ErrorBoundaryScreen({
  error,
  reset,
  homeHref,
  homeLabel,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  homeHref: string;
  homeLabel: string;
}) {
  const path = usePathname();

  useEffect(() => {
    fetch("/api/log/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: error.message, digest: error.digest, path }),
      // Werkt door tijdens het verlaten van de pagina (bv. meteen op "Opnieuw
      // proberen" klikken) — beter geschikt dan een gewone fetch hiervoor.
      keepalive: true,
    }).catch(() => {});
    // Alleen bij het tonen van dit specifieke foutscherm loggen, niet bij
    // elke re-render (bv. na `reset`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center px-6 text-center">
      <p className="mb-2 text-lg font-semibold text-ink">Dat lukte niet</p>
      <p className="mb-6 text-sm text-ink-muted">{error.message || "Er ging iets mis. Probeer het opnieuw."}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
        >
          Opnieuw proberen
        </button>
        <Link href={homeHref} className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-muted">
          {homeLabel}
        </Link>
      </div>
    </div>
  );
}
