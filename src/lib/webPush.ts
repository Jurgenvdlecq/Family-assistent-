import webpush from "web-push";

let configured = false;

function ensureConfigured() {
  if (configured) return;
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error("WEB_PUSH_PUBLIC_KEY/WEB_PUSH_PRIVATE_KEY/WEB_PUSH_SUBJECT ontbreken.");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

export type PushSendResult =
  | { outcome: "sent" }
  | { outcome: "gone" } // subscription is verlopen/ingetrokken — mag uitgeschakeld worden
  | { outcome: "error"; message: string };

/**
 * Dunne wrapper om `web-push` — houdt de VAPID-configuratie op één plek en
 * vertaalt HTTP-statuscodes naar een klein, expliciet resultaattype zodat
 * de aanroeper (de cron-route) nooit zelf statuscode-logica hoeft te kennen.
 */
export async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload
): Promise<PushSendResult> {
  ensureConfigured();
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload)
    );
    return { outcome: "sent" };
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      return { outcome: "gone" };
    }
    return { outcome: "error", message: error instanceof Error ? error.message : "Onbekende fout" };
  }
}
