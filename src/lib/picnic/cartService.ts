import { prisma } from "../prisma";
import { PicnicClient, PicnicAuthError, PicnicNetworkError } from "./client";
import {
  describeLinePackaging,
  invalidateShoppingList,
  isUserChosenPackageCount,
  releaseNextWeekMealDays,
} from "../shoppingList";
import { logEvent, createCorrelationId } from "../logger";
import type { LineSource } from "@/generated/prisma/enums";

export interface PicnicCartResult {
  added: { ingredientName: string; picnicName: string; count: number }[];
  skipped: { ingredientName: string }[];
  notFound: string[];
  errors: { ingredientName: string; message: string }[];
  /** Verwerking is halverwege gestopt door een auth-/netwerkfout — herhalen heeft pas zin nadat dat is opgelost. */
  stoppedEarly: boolean;
}

export type PicnicCartClearResult = { ok: true } | { ok: false; message: string };

/**
 * Vertaalt een Picnic-/verbindingsfout naar een vaste, Nederlandse melding.
 * Bewust nooit een ruwe Error laten "bubbelen" tot buiten deze module: een
 * server action die direct als functie vanuit een client component wordt
 * aangeroepen (zoals clearPicnicCart) gooit z'n `throw` over de Server-
 * Actions-grens, en Next.js redact in productiebuilds de exacte boodschap
 * van zo'n throw (zelfde reden als WP89's fix voor recept-import) — de
 * gebruiker zag daardoor alleen "An error occurred in the Server Components
 * render", nooit de eigenlijke (uitlegbare) foutmelding.
 */
function describePicnicError(error: unknown): string {
  if (error instanceof PicnicAuthError) {
    return "Picnic-sessie verlopen of ongeldig. Koppel je Picnic-account opnieuw bij Ons gezin.";
  }
  if (error instanceof PicnicNetworkError) {
    return "Geen verbinding met Picnic — probeer het later opnieuw.";
  }
  if (error instanceof Error) return error.message;
  return "Onbekende fout bij Picnic.";
}

/**
 * Zoekt elk nog niet overgedragen boodschappenlijst-item bij Picnic en voegt
 * de best passende match toe aan het echte Picnic-mandje. Idempotent
 * (Fase 7/8): een regel met transferredToPicnicAt wordt overgeslagen, dus
 * opnieuw op de knop drukken na een gedeeltelijke mislukking voegt niets
 * dubbel toe. Bij een auth- of netwerkfout (die voor elke volgende regel
 * hetzelfde resultaat zou geven) stopt de verwerking meteen in plaats van
 * dezelfde storing per regel te herhalen.
 *
 * `options.onlySources` beperkt dit tot een deel van de lijst (WP91: "alleen
 * vaste boodschappen", zonder de weekmenu-regels) — de aanroeper is
 * verantwoordelijk voor het kiezen van de juiste bronnen en voor het niet
 * markeren van de hele lijst als overgedragen bij een gedeeltelijke run.
 */
export async function addShoppingListToPicnicCart(
  shoppingListId: string,
  options?: { onlySources?: readonly LineSource[] }
): Promise<PicnicCartResult> {
  const shoppingList = await prisma.shoppingList.findUniqueOrThrow({
    where: { id: shoppingListId },
    include: {
      mealPlan: { select: { householdId: true, weekStart: true } },
      lines: { include: { ingredient: true, product: true } },
    },
  });

  const household = await prisma.household.findUniqueOrThrow({
    where: { id: shoppingList.mealPlan.householdId },
  });

  if (!household.picnicAuthToken) {
    return {
      added: [],
      skipped: [],
      notFound: [],
      errors: [{ ingredientName: "", message: "Nog geen Picnic-account gekoppeld. Koppel je account bij Ons gezin." }],
      stoppedEarly: true,
    };
  }

  const scopedLines = options?.onlySources
    ? shoppingList.lines.filter((line) => options.onlySources!.includes(line.source))
    : shoppingList.lines;
  // Regels die je ergens anders haalt of zelf regelt horen niet in het
  // Picnic-mandje. Ze blijven wel gewoon op de lijst staan — als "zelf halen",
  // niet als iets wat de app stilzwijgend voor je bestelt.
  const linesToTransfer = scopedLines.filter((line) => line.fulfillment === "PICNIC");

  const correlationId = createCorrelationId();
  const client = new PicnicClient(household.picnicAuthToken);
  const result: PicnicCartResult = { added: [], skipped: [], notFound: [], errors: [], stoppedEarly: false };
  // Alleen tellen wat in déze aanroep echt is overgedragen — een "snelle
  // bestelling" (alleen vaste boodschappen en losse toevoegingen) mag de
  // dagkeuze niet aanraken.
  let transferredMealLines = 0;

  for (const line of linesToTransfer) {
    if (line.transferredToPicnicAt) {
      result.skipped.push({ ingredientName: line.ingredient.name });
      continue;
    }

    const searchLabel = line.product?.name ?? line.ingredient.name;
    try {
      const picnicProductId = line.product?.externalRef ?? null;
      const picnicName = searchLabel;

      if (!picnicProductId) {
        result.errors.push({
          ingredientName: line.ingredient.name,
          message: "Geen bevestigd Picnic-product. Zoek en kies dit product eerst op het Controle-scherm.",
        });
        continue;
      }

      const packageCount = getPackageCountForLine(line);
      await client.addProduct(picnicProductId, packageCount);
      result.added.push({ ingredientName: line.ingredient.name, picnicName, count: packageCount });

      await prisma.shoppingListLine.update({
        where: { id: line.id },
        data: { transferredToPicnicAt: new Date() },
      });
      if (line.source === "MEAL") transferredMealLines += 1;
    } catch (err) {
      if (err instanceof PicnicAuthError || err instanceof PicnicNetworkError) {
        result.errors.push({
          ingredientName: line.ingredient.name,
          message: err.message,
        });
        result.stoppedEarly = true;
        break;
      }
      result.errors.push({
        ingredientName: line.ingredient.name,
        message: err instanceof Error ? err.message : "Onbekende fout",
      });
    }
  }

  // Zijn er maaltijdboodschappen overgedragen, dan is de dagkeuze voor de
  // vólgende week afgehandeld: die avonden mogen niet opnieuw voorgesteld
  // worden zodra die week aanbreekt (zie releaseNextWeekMealDays).
  //
  // Alleen bij een volledig geslaagde overdracht, net zo streng als
  // `markTransferred`. Bij een halve overdracht (sessie verlopen halverwege,
  // een product dat faalde) liggen niet alle boodschappen van die avond in
  // het mandje; de avond dan toch vrijgeven laat de resterende regels bij een
  // volgende herbouw geruisloos van de lijst vallen — de gebruiker denkt
  // besteld te hebben en krijgt niets. Opnieuw drukken is idempotent, dus
  // "laten staan" is hier de veilige kant.
  if (transferredMealLines > 0 && !result.stoppedEarly && result.errors.length === 0) {
    await releaseNextWeekMealDays(shoppingList.mealPlan.householdId, shoppingList.mealPlan.weekStart);
  }

  // Er zijn producten bijgekomen ná een eerder "ik heb besteld": die zaten
  // niet in die bestelling. De bevestiging dekt ze dus niet, en het bonnetje
  // zou ze anders meetellen als "besteld". Wissen zorgt bovendien dat de
  // herinnering "rond je bestelling af in Picnic" weer verschijnt.
  if (result.added.length > 0) {
    await prisma.shoppingList.updateMany({
      where: { id: shoppingListId, orderConfirmedAt: { not: null } },
      data: { orderConfirmedAt: null },
    });
  }

  await persistRefreshedToken(client, household.id, household.picnicAuthToken);

  logEvent({
    level: result.errors.length > 0 ? "warn" : "info",
    area: "picnic_cart",
    message: "Mandje vullen afgerond",
    correlationId,
    meta: {
      shoppingListId,
      added: result.added.length,
      skipped: result.skipped.length,
      notFound: result.notFound.length,
      errors: result.errors.length,
      stoppedEarly: result.stoppedEarly,
    },
  });

  return result;
}

/**
 * Leegt het echte Picnic-mandje en zet de overdrachtsstatus van deze lijst
 * terug, zodat "Toevoegen" daarna weer alles opnieuw plaatst. Gooit bewust
 * nooit — deze functie wordt rechtstreeks als async functie vanuit een
 * client component aangeroepen (geen formulier/redirect), en elke `throw`
 * die de Server-Actions-grens over gaat wordt door Next.js in productie
 * herleid tot een nietszeggende generieke melding (zie describePicnicError
 * hierboven). Een `{ ok: false, message }`-resultaat komt wél met de echte,
 * Nederlandse boodschap bij de gebruiker aan.
 */
export async function clearPicnicCartForShoppingList(shoppingListId: string): Promise<PicnicCartClearResult> {
  const shoppingList = await prisma.shoppingList.findUniqueOrThrow({
    where: { id: shoppingListId },
    include: { mealPlan: { select: { householdId: true } } },
  });

  const household = await prisma.household.findUniqueOrThrow({
    where: { id: shoppingList.mealPlan.householdId },
  });

  if (!household.picnicAuthToken) {
    return { ok: false, message: "Nog geen Picnic-account gekoppeld. Koppel je account bij Ons gezin." };
  }

  const client = new PicnicClient(household.picnicAuthToken);
  try {
    await client.clearCart();
  } catch (err) {
    await persistRefreshedToken(client, household.id, household.picnicAuthToken);
    logEvent({
      level: "warn",
      area: "picnic_cart",
      message: "Mandje legen mislukt",
      meta: { shoppingListId, error: err instanceof Error ? err.message : String(err) },
    });
    return { ok: false, message: describePicnicError(err) };
  }
  await persistRefreshedToken(client, household.id, household.picnicAuthToken);

  logEvent({
    level: "info",
    area: "picnic_cart",
    message: "Mandje geleegd",
    meta: { shoppingListId },
  });

  await prisma.shoppingListLine.updateMany({
    where: { shoppingListId, transferredToPicnicAt: { not: null } },
    data: { transferredToPicnicAt: null },
  });

  // Het mandje is nu leeg, dus niets houdt de lijst nog vast aan een eerdere
  // bestelling: hij mag weer precies weerspiegelen wat er nú gekozen is.
  // Zonder deze herbouw bleven producten van een vorige bestelling staan
  // terwijl er geen enkele avond meer aangevinkt was — je kon ze dan alleen
  // nog stuk voor stuk met het kruisje weghalen. Handmatig toegevoegde
  // producten blijven staan (zie invalidateShoppingList).
  await invalidateShoppingList(shoppingList.mealPlanId, { keepListRow: true });

  return { ok: true };
}

async function persistRefreshedToken(client: PicnicClient, householdId: string, previousToken: string) {
  const refreshedToken = client.getAuthToken();
  if (refreshedToken && refreshedToken !== previousToken) {
    await prisma.household.update({
      where: { id: householdId },
      data: { picnicAuthToken: refreshedToken, picnicTokenUpdatedAt: new Date() },
    });
  }
}

function getPackageCountForLine(line: {
  quantity: number;
  unit: "GRAM" | "ML" | "PIECE";
  source: string;
  product: { packageQuantity: number | null } | null;
}) {
  if (isUserChosenPackageCount(line)) return Math.max(1, Math.ceil(line.quantity));

  const packaging = describeLinePackaging(line, line.product);
  if (packaging.status === "OK") return packaging.packagesToBuy;
  if (line.unit === "PIECE") return Math.max(1, Math.ceil(line.quantity));
  return 1;
}
