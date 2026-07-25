import { prisma } from "./prisma";
import { PicnicClient } from "./picnic/client";
import { fuzzyScore, searchTermVariants } from "./picnic/matching";
import type { PicnicSearchResultItem } from "./picnic/searchResults";

/**
 * Picnic-adapter — vervangbare interface (sectie 2 van het ontwerpdocument).
 * Er is geen officiële, gedocumenteerde Picnic-partner-API (risico R1 uit
 * de kritische review) — alles hieronder praat met de niet-officiële,
 * reverse-engineered app-API. De rest van de app kent alleen deze twee
 * functies (preparePicnicTransfer voor de kopieerbare lijst,
 * addShoppingListToPicnicCart voor de echte koppeling); precies daarom kon
 * de echte integratie er later achter geschoven worden zonder dat er
 * verder iets hoefde te veranderen.
 */
export async function preparePicnicTransfer(shoppingListId: string) {
  const shoppingList = await prisma.shoppingList.findUniqueOrThrow({
    where: { id: shoppingListId },
    include: { lines: { include: { ingredient: true, product: true } } },
  });

  const lines = [...shoppingList.lines].sort((a, b) =>
    a.ingredient.name.localeCompare(b.ingredient.name)
  );

  const text = lines
    .map((line) => {
      const label = line.product?.name ?? line.ingredient.name;
      const detail = line.product?.packageSize ? ` (${line.product.packageSize})` : "";
      return `- ${label}${detail}`;
    })
    .join("\n");

  return { text, itemCount: lines.length, status: shoppingList.status };
}

export async function markTransferred(shoppingListId: string) {
  await prisma.shoppingList.update({
    where: { id: shoppingListId },
    data: { status: "TRANSFERRED" },
  });
}

export interface PicnicCartResult {
  added: { ingredientName: string; picnicName: string }[];
  notFound: string[];
  errors: { ingredientName: string; message: string }[];
}

/**
 * Zoekt elk boodschappenlijst-item bij Picnic en voegt de best passende
 * match toe aan het echte Picnic-mandje. Vereist dat het huishouden
 * eenmalig is ingelogd (npm run picnic:login). Een eerder gevonden match
 * wordt onthouden op Product.externalRef, zodat er de volgende week niet
 * opnieuw gezocht hoeft te worden voor hetzelfde product.
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

  const client = new PicnicClient(household.picnicAuthToken);
  const result: PicnicCartResult = { added: [], notFound: [], errors: [] };

  for (const line of shoppingList.lines) {
    const searchLabel = line.product?.name ?? line.ingredient.name;
    try {
      if (line.product?.externalRef) {
        await client.addProduct(line.product.externalRef);
        result.added.push({ ingredientName: line.ingredient.name, picnicName: searchLabel });
        continue;
      }

      const match = await findBestMatch(client, searchLabel);
      if (!match?.id) {
        result.notFound.push(searchLabel);
        continue;
      }

      await client.addProduct(match.id);
      result.added.push({ ingredientName: line.ingredient.name, picnicName: match.name ?? searchLabel });

      if (line.productId) {
        await prisma.product.update({
          where: { id: line.productId },
          data: { externalRef: match.id },
        });
      }
    } catch (err) {
      result.errors.push({
        ingredientName: line.ingredient.name,
        message: err instanceof Error ? err.message : "Onbekende fout",
      });
    }
  }

  const refreshedToken = client.getAuthToken();
  if (refreshedToken && refreshedToken !== household.picnicAuthToken) {
    await prisma.household.update({
      where: { id: household.id },
      data: { picnicAuthToken: refreshedToken, picnicTokenUpdatedAt: new Date() },
    });
  }

  return result;
}

async function findBestMatch(
  client: PicnicClient,
  searchLabel: string
): Promise<PicnicSearchResultItem | null> {
  for (const term of searchTermVariants(searchLabel)) {
    const results = await client.search(term);
    const scored = results
      .filter((r) => r.id)
      .map((r) => ({ item: r, score: fuzzyScore(searchLabel, r.name ?? "") }))
      .sort((a, b) => b.score - a.score);
    if (scored.length > 0) return scored[0].item;
  }
  return null;
}
