"use client";

import ErrorBoundaryScreen from "@/components/ErrorBoundaryScreen";

/**
 * Server actions op deze pagina gooien bewuste, leesbare foutmeldingen
 * (bijv. "dit recept staat deze week nog op het menu") in plaats van
 * stilzwijgend iets fout te laten gaan. Zonder deze boundary zou Next.js
 * die tekst tonen als een generieke crash-pagina — precies het "technische
 * foutmelding"-gedrag dat de app juist wil vermijden.
 */
export default function ReceptenError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorBoundaryScreen error={error} reset={reset} homeHref="/recepten" homeLabel="Terug naar recepten" />;
}
