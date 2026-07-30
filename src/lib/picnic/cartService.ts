import { prisma } from "../prisma";
import { PicnicClient, PicnicAuthError, PicnicNetworkError } from "./client";
import { describeLinePackaging, isUserChosenPackageCount } from "../shoppingList";
import { logEvent, createCorrelationId } from "../logger";

export interface PicnicCartResult {
  added: { ingredientName: string; picnicName: string; count: number }[];
  skipped: { ingredientName: string }[];
  notFound: string[];
  errors: { ingredientName: string; message: string }[];
  /** Verwerking is halverwege gestopt door een auth-/netwerkfout — herhalen heeft pas zin nadat dat is opgelost. */
  stoppedEarly: boolean;
}

/**
 * Zoekt elk nog niet overgedragen boodschappenlijst-item bij Picnic en voegt
 * de best passende match toe aan het echte Picnic-mandje. Idempotent
 * (Fase 7/8): een regel met transferredToPicnicAt wordt overgeslagen, dus
 * opnieuw op de knop drukken na een gedeeltelijke mislukking voegt niets
 * dubbel toe. Bij een auth- of netwerkfout (die voor elke volgende regel
 * hetzelfde resultaat zou geven) stopt de verwerking meteen in plaats van
 * dezelfde storing per regel te herhalen.
 */
export async function addShoppingListToPicnicCart(
  shoppingListId: string
): Promise<PicnicCartResult> {
  const shoppingList = await prisma.shoppingList.findUniqueOrThrow({
    where: { id: shoppingListId },
    include: {
      mealPlan: { select: { householdId: true } },
      lines: { include: { ingredient: true, product: true } },
    },
  });

  const household = await prisma.household.findUniqueOrThrow({
    where: { id: shoppingList.mealPlan.householdId },
  });

  if (!household.picnicAuthToken) {
    throw new Error(
      "Nog geen Picnic-account gekoppeld. Draai eenmalig in de terminal: npm run picnic:login"
    );
  }

  const correlationId = createCorrelationId();
  const client = new PicnicClient(household.picnicAuthToken);
  const result: PicnicCartResult = { added: [], skipped: [], notFound: [], errors: [], stoppedEarly: false };

  for (const line of shoppingList.lines) {
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

/** Leegt het echte Picnic-mandje en zet de overdrachtsstatus van deze lijst terug, zodat "Toevoegen" daarna weer alles opnieuw plaatst. */
export async function clearPicnicCartForShoppingList(shoppingListId: string): Promise<void> {
  const shoppingList = await prisma.shoppingList.findUniqueOrThrow({
    where: { id: shoppingListId },
    include: { mealPlan: { select: { householdId: true } } },
  });

  const household = await prisma.household.findUniqueOrThrow({
    where: { id: shoppingList.mealPlan.householdId },
  });

  if (!household.picnicAuthToken) {
    throw new Error(
      "Nog geen Picnic-account gekoppeld. Draai eenmalig in de terminal: npm run picnic:login"
    );
  }

  const client = new PicnicClient(household.picnicAuthToken);
  await client.clearCart();
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
