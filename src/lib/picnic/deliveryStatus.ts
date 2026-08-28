import { prisma } from "@/lib/prisma";
import { PicnicAuthError, PicnicClient } from "./client";
import { parseCartItemCount } from "./cartState";
import {
  parseDeliverySlotsResponse,
  findPreferredDeliverySlotStatus,
  groupDeliverySlotsByDay,
  type DeliveryDayGroup,
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

export type DeliveryOverview = {
  /** Wanneer deze gegevens bij Picnic zijn opgehaald — de UI toont dit, zodat
   * een scherm dat al even openstaat niet doorgaat voor actueel. */
  fetchedAt: Date;
  groups: DeliveryDayGroup[];
  /** Alleen gevuld als het huishouden een voorkeursmoment heeft ingesteld. */
  preferred: PreferredDeliverySlotStatus | null;
  /**
   * Hoeveel producten er op dit moment in het echte Picnic-mandje liggen, of
   * `null` als dat niet met zekerheid te lezen was. Komt uit dezelfde aanroep
   * als de bezorgmomenten.
   */
  cartItemCount: number | null;
  error: "auth" | "other" | null;
};

/**
 * Haalt in één Picnic-aanroep het volledige bezorgoverzicht op: alle dagen
 * met hun nog vrije tijdvakken, plus — als het huishouden er een heeft
 * ingesteld — de status van het voorkeursmoment. Bewust één aanroep voor
 * beide, in plaats van `getPreferredDeliverySlotStatusForHousehold` ernaast
 * (dat zou dezelfde lijst een tweede keer ophalen).
 *
 * Faalt nooit hard: een verlopen sessie of storing komt terug als `error`,
 * zodat de pagina gewoon rendert met een herstelbanner (zelfde patroon als
 * de zoekopdrachten op /boodschappen).
 */
export async function getDeliveryOverviewForHousehold(input: {
  householdId: string;
  picnicAuthToken: string;
  preference: { preferredDayOfWeek: DayOfWeek; preferredTime: string; windowMinutes: number } | null;
}): Promise<DeliveryOverview> {
  const client = new PicnicClient(input.picnicAuthToken);
  try {
    const { cart, slots: raw } = await client.getCartAndDeliverySlots();
    await persistRefreshedToken(client, input.householdId, input.picnicAuthToken);
    const slots = parseDeliverySlotsResponse(raw);
    return {
      fetchedAt: new Date(),
      groups: groupDeliverySlotsByDay(slots),
      cartItemCount: parseCartItemCount(cart),
      preferred: input.preference
        ? findPreferredDeliverySlotStatus({
            slots,
            preferredDay: input.preference.preferredDayOfWeek,
            preferredTime: input.preference.preferredTime,
            windowMinutes: input.preference.windowMinutes,
          })
        : null,
      error: null,
    };
  } catch (error) {
    logEvent({
      level: "warn",
      area: "picnic_delivery_slots",
      message: "Kon het Picnic-bezorgoverzicht niet ophalen",
      correlationId: createCorrelationId(),
      meta: { householdId: input.householdId, error: errorMessage(error) },
    });
    return {
      fetchedAt: new Date(),
      groups: [],
      preferred: null,
      cartItemCount: null,
      error: error instanceof PicnicAuthError ? "auth" : "other",
    };
  }
}
