"use client";

import { useEffect, useState, useTransition } from "react";
import { BellRing, BellOff } from "lucide-react";
import { subscribeToPush, unsubscribeFromPush, updateNotificationPreference } from "./pushActions";
import type { AttentionItemType } from "@/domain/attention/attentionItems";

const NOTIFICATION_LABELS: { type: AttentionItemType; label: string }[] = [
  { type: "WEEK_MENU_READY_NO_GROCERIES", label: "Weekmenu klaar, nog geen boodschappenlijst" },
  { type: "PRODUCT_REVIEW_OPEN", label: "Productcontrole staat al een paar dagen open" },
  { type: "GROCERIES_READY_NOT_SENT_TO_PICNIC", label: "Boodschappenlijst klaar, nog niet naar Picnic" },
  { type: "PICNIC_CART_FILLED_NOT_CONFIRMED", label: "Picnic-mandje gevuld, bestelling nog niet bevestigd" },
];

type SupportStatus = "checking" | "unsupported" | "ios-needs-install" | "supported";

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

export default function PushNotificationSettings({
  householdId,
  vapidPublicKey,
  initialPreferences,
}: {
  householdId: string;
  vapidPublicKey: string | null;
  initialPreferences: Partial<Record<AttentionItemType, boolean>>;
}) {
  const [supportStatus, setSupportStatus] = useState<SupportStatus>("checking");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [preferences, setPreferences] = useState(initialPreferences);

  useEffect(() => {
    let cancelled = false;
    async function checkStatus() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !vapidPublicKey) {
        if (!cancelled) setSupportStatus("unsupported");
        return;
      }
      if (isIos() && !isStandalone()) {
        if (!cancelled) setSupportStatus("ios-needs-install");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        const existing = await registration.pushManager.getSubscription();
        if (cancelled) return;
        setEndpoint(existing?.endpoint ?? null);
        setSupportStatus("supported");
      } catch {
        if (!cancelled) setSupportStatus("unsupported");
      }
    }
    checkStatus();
    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  function handleEnable() {
    setError(null);
    startTransition(async () => {
      try {
        if (Notification.permission === "denied") {
          setError("Meldingen zijn geblokkeerd voor deze site in je browserinstellingen.");
          return;
        }
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setError("Geen toestemming gekregen voor meldingen.");
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!),
        });
        const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
        await subscribeToPush(householdId, json, navigator.userAgent);
        setEndpoint(subscription.endpoint);
      } catch {
        setError("Meldingen inschakelen is niet gelukt. Probeer het opnieuw.");
      }
    });
  }

  function handleDisable() {
    setError(null);
    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await subscription.unsubscribe();
          await unsubscribeFromPush(householdId, subscription.endpoint);
        }
        setEndpoint(null);
      } catch {
        setError("Meldingen uitschakelen is niet gelukt. Probeer het opnieuw.");
      }
    });
  }

  function handleTogglePreference(type: AttentionItemType, enabled: boolean) {
    setPreferences((prev) => ({ ...prev, [type]: enabled }));
    startTransition(async () => {
      await updateNotificationPreference(householdId, type, enabled);
    });
  }

  if (supportStatus === "checking") return null;

  if (supportStatus === "unsupported") {
    return (
      <p className="rounded-lg bg-surface-2 p-3 text-xs text-ink-muted">
        Pushmeldingen worden niet ondersteund in deze browser.
      </p>
    );
  }

  if (supportStatus === "ios-needs-install") {
    return (
      <p className="rounded-lg bg-surface-2 p-3 text-xs text-ink-muted">
        Wil je meldingen op je iPhone? Zet Family Assistant eerst op je beginscherm: tik in Safari op
        het deelicoon en kies &ldquo;Zet op beginscherm&rdquo;. Open de app daarna vanaf dat icoon —
        pas dan kun je hier meldingen inschakelen.
      </p>
    );
  }

  return (
    <div className="min-w-0">
      {!endpoint ? (
        <button
          type="button"
          onClick={handleEnable}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
        >
          <BellRing size={16} />
          {isPending ? "Bezig…" : "Meldingen inschakelen"}
        </button>
      ) : (
        <div>
          <p className="mb-3 flex items-center gap-2 text-sm font-medium text-tag-green-ink">
            <BellRing size={16} />
            Meldingen staan aan op dit toestel
          </p>
          <div className="mb-3 grid gap-2">
            {NOTIFICATION_LABELS.map(({ type, label }) => (
              <label key={type} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={preferences[type] ?? true}
                  onChange={(e) => handleTogglePreference(type, e.target.checked)}
                  className="h-4 w-4 rounded border-line text-accent"
                />
                {label}
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={handleDisable}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-muted hover:bg-surface-2 disabled:opacity-50"
          >
            <BellOff size={16} />
            {isPending ? "Bezig…" : "Meldingen uitschakelen op dit toestel"}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
