"use client";

import ErrorBoundaryScreen from "@/components/ErrorBoundaryScreen";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorBoundaryScreen error={error} reset={reset} homeHref="/" homeLabel="Terug naar de app" />;
}
