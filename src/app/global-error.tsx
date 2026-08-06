"use client";

import Link from "next/link";

/**
 * Vangnet voor fouten in de root-layout zelf — daar komt `error.tsx` niet
 * bij (Next.js vereist hiervoor een aparte global-error met eigen
 * <html>/<body>). Bewust simpel en zonder app-componenten: als dit rendert
 * is er iets fundamenteels mis, dus geen afhankelijkheden die zelf ook
 * stuk kunnen zijn. Zonder dit bestand zag de gebruiker een kale,
 * Engelstalige Next.js-pagina.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="nl">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "3rem 1.5rem", maxWidth: "36rem", margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.4rem", marginBottom: "0.5rem" }}>Er ging iets mis</h1>
        <p style={{ color: "#555", marginBottom: "1.5rem" }}>
          De app kon deze pagina niet laden. Je gegevens zijn veilig — probeer het opnieuw.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            padding: "0.6rem 1.2rem",
            borderRadius: "0.5rem",
            border: "1px solid #ccc",
            background: "#fff",
            cursor: "pointer",
            marginRight: "0.75rem",
          }}
        >
          Opnieuw proberen
        </button>
        <Link href="/" style={{ color: "#555" }}>
          Terug naar Jouw week
        </Link>
      </body>
    </html>
  );
}
