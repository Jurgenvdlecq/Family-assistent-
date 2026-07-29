import { prisma } from "../prisma";
import {
  PicnicClient,
  PicnicAuthError,
  PicnicNetworkError,
  Picnic2FARequiredError,
} from "./client";
import { logEvent, createCorrelationId, errorMessage } from "../logger";

export type PicnicConnectOutcome =
  | "connected"
  | "twoFactorNeeded"
  | "twoFactorGenerateFailed"
  | "wrongCredentials"
  | "networkError"
  | "missingFields"
  | "failed";

/**
 * Kernlogica achter "Picnic koppelen" (Fase 7), los van de "use server"-actie
 * (`src/app/ons-gezin/picnicActions.ts`) die alleen autorisatie en de
 * redirect toevoegt. Gescheiden zodat dit — net als de rest van de
 * Picnic-integratie (`cartService.ts`, `client.ts`) — met een gefakete
 * `fetch` getest kan worden, zonder een echte Next.js-requestcontext nodig
 * te hebben voor `cookies()`/`redirect()`.
 */
export async function connectPicnicAccountForHousehold(
  householdId: string,
  username: string,
  password: string
): Promise<PicnicConnectOutcome> {
  if (!username || !password) return "missingFields";

  const correlationId = createCorrelationId();
  const client = new PicnicClient();

  try {
    await client.login(username, password);
  } catch (error) {
    if (error instanceof Picnic2FARequiredError) {
      // Het inlogantwoord bevat al een gedeeltelijk token dat nodig is om
      // de sms/e-mail-code te kunnen verifiëren — apart van het echte,
      // werkende picnicAuthToken opgeslagen (zie schema-comment).
      await prisma.household.update({
        where: { id: householdId },
        data: { picnicPendingAuthToken: client.getAuthToken() ?? null },
      });
      try {
        await client.generate2FACode("SMS");
      } catch (generateError) {
        logEvent({
          level: "warn",
          area: "picnic_auth",
          message: "Picnic-verificatiecode aanvragen mislukt",
          correlationId,
          meta: { householdId, error: errorMessage(generateError) },
        });
        return "twoFactorGenerateFailed";
      }
      return "twoFactorNeeded";
    }

    logEvent({
      level: "warn",
      area: "picnic_auth",
      message: "Picnic koppelen mislukt",
      correlationId,
      meta: { householdId, error: errorMessage(error) },
    });
    if (error instanceof PicnicAuthError) return "wrongCredentials";
    if (error instanceof PicnicNetworkError) return "networkError";
    return "failed";
  }

  const token = client.getAuthToken();
  if (!token) return "failed";

  await prisma.household.update({
    where: { id: householdId },
    data: { picnicAuthToken: token, picnicTokenUpdatedAt: new Date(), picnicPendingAuthToken: null },
  });
  return "connected";
}

export async function verifyPicnicTwoFactorCodeForHousehold(
  householdId: string,
  code: string
): Promise<PicnicConnectOutcome | "twoFactorExpired" | "twoFactorWrongCode"> {
  const household = await prisma.household.findUniqueOrThrow({ where: { id: householdId } });
  if (!household.picnicPendingAuthToken) return "twoFactorExpired";

  const correlationId = createCorrelationId();
  const client = new PicnicClient(household.picnicPendingAuthToken);

  try {
    await client.verify2FACode(code);
  } catch (error) {
    logEvent({
      level: "warn",
      area: "picnic_auth",
      message: "Picnic-verificatiecode klopt niet",
      correlationId,
      meta: { householdId, error: errorMessage(error) },
    });
    return "twoFactorWrongCode";
  }

  const token = client.getAuthToken();
  if (!token) return "failed";

  await prisma.household.update({
    where: { id: householdId },
    data: { picnicAuthToken: token, picnicTokenUpdatedAt: new Date(), picnicPendingAuthToken: null },
  });
  return "connected";
}
