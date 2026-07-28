"use client";

import Link from "next/link";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
        <Link href="/" className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-muted">
          Terug naar Jouw week
        </Link>
      </div>
    </div>
  );
}
