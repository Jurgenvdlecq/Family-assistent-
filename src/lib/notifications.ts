import { prisma } from "./prisma";
import { getCurrentWeekStart } from "./week";
import { ensureMealPlan } from "./mealPlan";
import { getAttentionItemsForMealPlan } from "./attention";
import {
  isWithinNotificationWindow,
  notificationDayKey,
  selectNotificationToSend,
} from "@/domain/attention/notificationPolicy";
import type { AttentionItemType } from "@/domain/attention/attentionItems";
import { sendPushNotification, type PushSendResult } from "./webPush";
import { logEvent, createCorrelationId, errorMessage } from "./logger";
import { shouldCheckDeliverySlotToday } from "./picnic/deliverySlots";
import { getPreferredDeliverySlotStatusForHousehold } from "./picnic/deliveryStatus";
import { DAY_KEY_BY_ENUM, DAY_LABELS } from "./week";

// `NotificationType` (Prisma) heeft naast de vier `AttentionItemType`-waarden
// ook `PICNIC_DELIVERY_SLOT_AT_RISK` (WP71/72) — die hoort niet bij
// attentionItems.ts (die is puur DB-afgeleid; het bezorgmoment vraagt een
// live Picnic-check + de dag-van-de-week, zie `getDeliverySlotNotificationCandidate`
// hieronder). Deze guard voorkomt dat zo'n extra waarde een verkeerd
// getypeerde `Set<AttentionItemType>` oplevert bij `selectNotificationToSend`.
const ATTENTION_ITEM_TYPES = new Set<string>([
  "WEEK_MENU_READY_NO_GROCERIES",
  "PRODUCT_REVIEW_OPEN",
  "GROCERIES_READY_NOT_SENT_TO_PICNIC",
  "PICNIC_CART_FILLED_NOT_CONFIRMED",
] satisfies AttentionItemType[]);

function isAttentionItemType(type: string): type is AttentionItemType {
  return ATTENTION_ITEM_TYPES.has(type);
}

type NotificationCandidateType = AttentionItemType | "PICNIC_DELIVERY_SLOT_AT_RISK";

type NotificationCandidate = {
  type: NotificationCandidateType;
  title: string;
  body: string;
  href: string;
};

export async function savePushSubscription(
  householdId: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent: string | undefined
) {
  await prisma.pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    update: { householdId, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, userAgent, disabledAt: null, lastSeenAt: new Date() },
    create: {
      householdId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent,
    },
  });
}

export async function removePushSubscription(householdId: string, endpoint: string) {
  // Scoped op householdId — een huishouden mag nooit andermans subscription
  // kunnen verwijderen, ook al zou het endpoint bekend zijn (Fase 14).
  await prisma.pushSubscription.deleteMany({ where: { endpoint, householdId } });
}

export async function getNotificationPreferences(householdId: string) {
  const rows = await prisma.notificationPreference.findMany({ where: { householdId } });
  return new Map(rows.map((row) => [row.type, row.enabled]));
}

export async function setNotificationPreference(householdId: string, type: AttentionItemType, enabled: boolean) {
  await prisma.notificationPreference.upsert({
    where: { householdId_type: { householdId, type } },
    update: { enabled },
    create: { householdId, type, enabled },
  });
}

async function getPreferenceEnabledByType(householdId: string): Promise<Partial<Record<AttentionItemType, boolean>>> {
  const rows = await prisma.notificationPreference.findMany({ where: { householdId } });
  return Object.fromEntries(rows.map((row) => [row.type, row.enabled]));
}

async function getAlreadySentToday(householdId: string, dayKey: string) {
  const rows = await prisma.notificationDeliveryLog.findMany({
    where: { householdId, dayKey },
    select: { type: true },
  });
  return {
    typesAlreadySentToday: new Set(rows.map((row) => row.type).filter(isAttentionItemType)),
    householdAlreadySentAnyToday: rows.length > 0,
  };
}

/**
 * WP72: de tweede — en enige andere — bron voor een pushmelding, los van
 * attentionItems.ts. Die laag is bewust puur DB-afgeleid (geen `now`, geen
 * live netwerkaanroep); een bezorgmoment-risico kan alleen bepaald worden
 * met de dag-van-de-week (`shouldCheckDeliverySlotToday`) én een live
 * Picnic-check, dus dat hoort hier thuis, niet in attentionItems.ts.
 * Geeft bewust `null` terug bij `UNKNOWN` (Picnic kon niet gecontroleerd
 * worden): dat zou een foutmelding pushen in plaats van een echt signaal —
 * de statuskaart op `/boodschappen` toont dat al eerlijk bij een bezoek.
 */
async function getDeliverySlotNotificationCandidate(
  householdId: string,
  now: Date
): Promise<NotificationCandidate | null> {
  const household = await prisma.household.findUnique({
    where: { id: householdId },
    select: { picnicAuthToken: true, picnicDeliveryPreference: true },
  });
  const preference = household?.picnicDeliveryPreference;
  if (!household?.picnicAuthToken || !preference || !preference.notificationsEnabled) return null;

  if (
    !shouldCheckDeliverySlotToday({
      preferredDayOfWeek: preference.preferredDayOfWeek,
      reminderDaysBefore: preference.reminderDaysBefore,
      now,
    })
  ) {
    return null;
  }

  const status = await getPreferredDeliverySlotStatusForHousehold({
    householdId,
    picnicAuthToken: household.picnicAuthToken,
    preferredDay: preference.preferredDayOfWeek,
    preferredTime: preference.preferredTime,
    windowMinutes: preference.windowMinutes,
  });
  if (status.status === "AVAILABLE" || status.status === "UNKNOWN") return null;

  const dayLabel = DAY_LABELS[DAY_KEY_BY_ENUM[preference.preferredDayOfWeek]].toLowerCase();
  return {
    type: "PICNIC_DELIVERY_SLOT_AT_RISK",
    title: `Bezorgmoment ${dayLabel} mogelijk niet meer beschikbaar`,
    body: status.message,
    href: "/boodschappen",
  };
}

/**
 * Doet het werk voor precies één huishouden: haalt dezelfde attention-items
 * op als de homepage, past het pushbeleid toe (voorkeuren, dedupe,
 * wachttijd), en stuurt — als er iets te sturen is — naar elke actieve
 * subscription van dit huishouden. Losstaand van `runReminderSweep` zodat
 * één falend huishouden de rest nooit kan blokkeren.
 */
export async function runReminderSweepForHousehold(
  householdId: string,
  now: Date,
  correlationId: string,
  // Injectiepunt voor tests (zelfde patroon als de `now`-parameter elders
  // in de codebase): de echte productiecode gebruikt altijd `sendPushNotification`
  // zelf; een test kan hier een fake meegeven om web-push's eigen HTTPS-only
  // transport niet nodig te hebben.
  sendFn: (
    subscription: { endpoint: string; p256dh: string; auth: string },
    payload: { title: string; body: string; url: string; tag: string }
  ) => Promise<PushSendResult> = sendPushNotification
): Promise<{ sent: boolean; type?: NotificationCandidateType }> {
  const weekStart = getCurrentWeekStart();
  const mealPlan = await ensureMealPlan(householdId, weekStart);
  const items = mealPlan ? await getAttentionItemsForMealPlan(mealPlan.id, mealPlan.createdAt) : [];

  const dayKey = notificationDayKey(now);
  const [preferenceEnabledByType, sentToday] = await Promise.all([
    getPreferenceEnabledByType(householdId),
    getAlreadySentToday(householdId, dayKey),
  ]);

  const chosen: NotificationCandidate | null =
    selectNotificationToSend({
      items,
      now,
      preferenceEnabledByType,
      typesAlreadySentToday: sentToday.typesAlreadySentToday,
      householdAlreadySentAnyToday: sentToday.householdAlreadySentAnyToday,
    }) ??
    (sentToday.householdAlreadySentAnyToday
      ? null
      : await getDeliverySlotNotificationCandidate(householdId, now));
  if (!chosen) return { sent: false };

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { householdId, disabledAt: null },
  });
  if (subscriptions.length === 0) return { sent: false };

  let sentToAtLeastOne = false;
  for (const subscription of subscriptions) {
    const result = await sendFn(subscription, {
      title: chosen.title,
      body: chosen.body,
      url: chosen.href,
      tag: chosen.type,
    });
    if (result.outcome === "sent") {
      sentToAtLeastOne = true;
      await prisma.pushSubscription.update({ where: { id: subscription.id }, data: { lastSeenAt: new Date() } });
    } else if (result.outcome === "gone") {
      await prisma.pushSubscription.update({ where: { id: subscription.id }, data: { disabledAt: new Date() } });
      logEvent({
        level: "info",
        area: "push_notifications",
        message: "Push-subscription uitgeschakeld (verlopen/ingetrokken)",
        correlationId,
        meta: { householdId, subscriptionId: subscription.id },
      });
    } else {
      logEvent({
        level: "warn",
        area: "push_notifications",
        message: "Push versturen mislukt",
        correlationId,
        meta: { householdId, subscriptionId: subscription.id, error: result.message },
      });
    }
  }

  if (sentToAtLeastOne) {
    await prisma.notificationDeliveryLog.create({
      data: { householdId, type: chosen.type, dayKey },
    });
  }

  return { sent: sentToAtLeastOne, type: chosen.type };
}

/** Doorloopt alle huishoudens — bedoeld voor het cron-endpoint. */
export async function runReminderSweep(now: Date = new Date()) {
  const correlationId = createCorrelationId();
  if (!isWithinNotificationWindow(now)) {
    return { withinWindow: false, checked: 0, sent: 0 };
  }

  const households = await prisma.household.findMany({
    where: { pushSubscriptions: { some: { disabledAt: null } } },
    select: { id: true },
  });

  let sent = 0;
  for (const household of households) {
    try {
      const result = await runReminderSweepForHousehold(household.id, now, correlationId);
      if (result.sent) sent += 1;
    } catch (error) {
      logEvent({
        level: "error",
        area: "push_notifications",
        message: "Reminder-sweep mislukt voor huishouden",
        correlationId,
        meta: { householdId: household.id, error: errorMessage(error) },
      });
    }
  }

  logEvent({
    level: "info",
    area: "push_notifications",
    message: "Reminder-sweep afgerond",
    correlationId,
    meta: { checked: households.length, sent },
  });

  return { withinWindow: true, checked: households.length, sent };
}
