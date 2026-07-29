"use client";

import { useState } from "react";
import { ShoppingCart, CheckCircle2 } from "lucide-react";
import {
  cancelPicnicTwoFactor,
  connectPicnicAccount,
  disconnectPicnicAccount,
  verifyPicnicTwoFactorCode,
} from "./picnicActions";

const ERROR_MESSAGES: Record<string, string> = {
  "picnic-missing-fields": "Vul zowel je e-mailadres als wachtwoord in.",
  "picnic-wrong-credentials": "Deze combinatie van e-mailadres en wachtwoord klopt niet volgens Picnic.",
  "picnic-network-error": "Geen verbinding met Picnic — probeer het over een paar minuten opnieuw.",
  "picnic-connect-failed": "Koppelen is niet gelukt. Probeer het opnieuw.",
  "picnic-2fa-generate-failed": "De verificatiecode kon niet worden aangevraagd. Probeer het opnieuw.",
  "picnic-2fa-wrong-code": "Deze verificatiecode klopt niet of is verlopen.",
  "picnic-2fa-expired": "Deze koppelpoging is verlopen. Begin opnieuw met je e-mailadres en wachtwoord.",
};

export default function PicnicConnection({
  householdId,
  connected,
  pendingTwoFactor,
  status,
}: {
  householdId: string;
  connected: boolean;
  pendingTwoFactor: boolean;
  status?: string;
}) {
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const errorMessage = status ? ERROR_MESSAGES[status] : undefined;

  return (
    <section className="mb-8 min-w-0 rounded-xl border border-line bg-surface p-4">
      <div className="mb-4 flex min-w-0 items-start gap-3">
        <ShoppingCart size={18} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0">
          <p className="font-medium text-ink">Picnic-account</p>
          <p className="text-sm text-ink-muted">
            {connected
              ? "Gekoppeld. Ik kan jullie boodschappenlijst rechtstreeks in het Picnic-mandje zetten."
              : "Koppel jullie Picnic-account zodat ik boodschappen voor je kan klaarzetten."}
          </p>
        </div>
      </div>

      {errorMessage && (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">
          {errorMessage}
        </p>
      )}

      {connected ? (
        <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-tag-green-ink">
            <CheckCircle2 size={15} /> Gekoppeld
          </span>
          {!confirmingDisconnect ? (
            <button
              type="button"
              onClick={() => setConfirmingDisconnect(true)}
              className="text-xs font-medium text-ink-faint underline decoration-dotted hover:text-red-600"
            >
              Ontkoppelen
            </button>
          ) : (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-ink-muted">Zeker weten?</span>
              <form action={disconnectPicnicAccount}>
                <input type="hidden" name="householdId" value={householdId} />
                <button type="submit" className="font-medium text-red-600 underline decoration-dotted">
                  Ja, ontkoppelen
                </button>
              </form>
              <button
                type="button"
                onClick={() => setConfirmingDisconnect(false)}
                className="font-medium text-ink-faint underline decoration-dotted"
              >
                Annuleren
              </button>
            </div>
          )}
        </div>
      ) : pendingTwoFactor ? (
        <form action={verifyPicnicTwoFactorCode} className="grid gap-2">
          <input type="hidden" name="householdId" value={householdId} />
          <p className="text-sm text-ink-muted">Picnic heeft jullie een verificatiecode gestuurd (sms).</p>
          <input
            type="text"
            inputMode="numeric"
            name="code"
            required
            autoFocus
            placeholder="Verificatiecode"
            className="rounded-lg border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
          />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:bg-accent/90">
              Bevestigen
            </button>
            <form action={cancelPicnicTwoFactor}>
              <input type="hidden" name="householdId" value={householdId} />
              <button type="submit" className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-muted hover:bg-surface-2">
                Annuleren
              </button>
            </form>
          </div>
        </form>
      ) : (
        <form action={connectPicnicAccount} className="grid gap-2">
          <input type="hidden" name="householdId" value={householdId} />
          <input
            type="email"
            name="username"
            required
            placeholder="Picnic e-mailadres"
            autoComplete="username"
            className="rounded-lg border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
          />
          <input
            type="password"
            name="password"
            required
            placeholder="Picnic wachtwoord"
            autoComplete="current-password"
            className="rounded-lg border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
          />
          <button type="submit" className="w-fit rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:bg-accent/90">
            Koppelen
          </button>
          <p className="text-xs text-ink-faint">
            Je wachtwoord wordt alleen gebruikt om bij Picnic in te loggen en daarna meteen weggegooid — er wordt alleen een sessie onthouden.
          </p>
        </form>
      )}
    </section>
  );
}
