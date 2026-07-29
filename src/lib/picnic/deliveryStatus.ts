import { prisma } from "@/lib/prisma";
import { PicnicClient } from "./client";
import {
  parseDeliverySlotsResponse,
  findPreferredDeliverySlotStatus,
  type PreferredDeliverySlotStatus,
} from "./deliverySlots";
import type { DayOfWeek } from "@/generated/prisma/enums";
import { logEvent, createCorrelationId, errorMessage } from "@/lib/logger";

async function persistRefreshedToken(client: PicnicClient, householdId: string, previousToken: string) {
  const refreshedToken = client.getAuthToken();
  if (refreshedToken && refreshedToken !== previousToken) {
    await prisma.household.update({
      where: { id: householdId },
      data: { picnicAuthToken: refreshedToken, picnicTokenUpdatedAt: new Date() },
    });
  }
}

/**
 * Haalt de actuele Picnic-bezorgmomenten op en bepaalt de status voor de
 * ingestelde voorkeur. Faalt nooit hard richting de aanroeper — een
 * auth-, netwerk- of API-fout wordt hier al vertaald naar "UNKNOWN" met
 * een voorzichtige tekst, precies zoals bij de rest van de niet-officiële
 * Picnic-koppeling (Fase 7: nooit een harde crash op een Picnic-storing).
 */
export async function getPreferredDeliverySlotStatusForHousehold(input: {
  householdId: string;
  picnicAuthToken: string;
  preferredDay: DayOfWeek;
  preferredTime: string;
  windowMinutes: number;
}): Promise<PreferredDeliverySlotStatus> {
  const client = new PicnicClient(input.picnicAuthToken);
  try {
    const raw = await client.getDeliverySlots();
    await persistRefreshedToken(client, input.householdId, input.picnicAuthToken);
    const slots = parseDeliverySlotsResponse(raw);
    return findPreferredDeliverySlotStatus({
      slots,
      preferredDay: input.preferredDay,
      preferredTime: input.preferredTime,
      windowMinutes: input.windowMinutes,
    });
  } catch (error) {
    logEvent({
      level: "warn",
      area: "picnic_delivery_slots",
      message: "Kon Picnic-bezorgmomenten niet controleren",
      correlationId: createCorrelationId(),
      meta: { householdId: input.householdId, error: errorMessage(error) },
    });
    return {
      status: "UNKNOWN",
      nearbySlots: [],
      message: "Picnic kon nu niet worden gecontroleerd.",
    };
  }
}
