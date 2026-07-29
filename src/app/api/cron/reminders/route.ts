import { headers } from "next/headers";
import { runReminderSweep } from "@/lib/notifications";
import { logEvent, createCorrelationId, errorMessage } from "@/lib/logger";

/**
 * WP70: door een cron (bijv. Vercel Cron) aangeroepen endpoint dat voor
 * alle huishoudens controleert of er een rustige herinnering te sturen
 * valt. Alle regels (tijdvenster, voorkeuren, dedupe, caps) zitten in
 * src/lib/notifications.ts / src/domain/attention — deze route is bewust
 * een dunne, geauthenticeerde wrapper eromheen, geen eigen logica.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    logEvent({ level: "error", area: "push_notifications", message: "CRON_SECRET ontbreekt", correlationId: createCorrelationId() });
    return new Response("Server niet geconfigureerd.", { status: 500 });
  }

  const headerList = await headers();
  const authHeader = headerList.get("authorization") ?? request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return new Response("Niet geautoriseerd.", { status: 401 });
  }

  try {
    const result = await runReminderSweep();
    return Response.json(result);
  } catch (error) {
    logEvent({
      level: "error",
      area: "push_notifications",
      message: "Cron-endpoint reminders mislukt",
      correlationId: createCorrelationId(),
      meta: { error: errorMessage(error) },
    });
    return new Response("Interne fout.", { status: 500 });
  }
}
