import type { Unit } from "@/generated/prisma/enums";
import { parsePackageQuantity } from "@/lib/quantity/parsePackageSize";
import { prisma } from "@/lib/prisma";
import { PicnicClient } from "./client";
import { fuzzyScore, searchTermVariants } from "./matching";
import { picnicPriceToEuros } from "./products";
import type { PicnicSearchResultItem } from "./searchResults";

const MAX_PRODUCTS_PER_RENDER = 8;
const MIN_IMAGE_MATCH_SCORE = 0.58;

type ProductCandidate = {
  id: string;
  name: string;
  packageSize: string | null;
  packageQuantity: number | null;
  price: unknown;
  ingredientName: string;
  unit: Unit;
};

function scoreSearchResult(product: ProductCandidate, item: PicnicSearchResultItem) {
  if (!item.name || !item.image_id) return 0;
  return Math.max(
    fuzzyScore(product.name, item.name),
    fuzzyScore(product.ingredientName, item.name) * 0.92
  );
}

async function findBestImageMatch(client: PicnicClient, product: ProductCandidate) {
  let best: { item: PicnicSearchResultItem; score: number } | null = null;
  const terms = [...searchTermVariants(product.name), ...searchTermVariants(product.ingredientName)];

  for (const term of Array.from(new Set(terms))) {
    const results = await client.search(term);
    for (const item of results) {
      const score = scoreSearchResult(product, item);
      if (!best || score > best.score) best = { item, score };
    }
    if (best && best.score >= 0.72) break;
  }

  return best && best.score >= MIN_IMAGE_MATCH_SCORE ? best.item : null;
}

export async function enrichShoppingListProductImages(householdId: string, shoppingListId: string) {
  const household = await prisma.household.findUnique({
    where: { id: householdId },
    select: { picnicAuthToken: true },
  });
  if (!household?.picnicAuthToken) return { attempted: 0, updated: 0 };

  const lines = await prisma.shoppingListLine.findMany({
    where: { shoppingListId },
    include: { ingredient: true, product: true },
  });

  const byProductId = new Map<string, ProductCandidate>();
  for (const line of lines) {
    if (!line.product || line.product.picnicImageId) continue;
    byProductId.set(line.product.id, {
      id: line.product.id,
      name: line.product.name,
      packageSize: line.product.packageSize,
      packageQuantity: line.product.packageQuantity,
      price: line.product.price,
      ingredientName: line.ingredient.name,
      unit: line.ingredient.unit,
    });
  }

  const products = Array.from(byProductId.values()).slice(0, MAX_PRODUCTS_PER_RENDER);
  if (products.length === 0) return { attempted: 0, updated: 0 };

  const client = new PicnicClient(household.picnicAuthToken);
  let updated = 0;

  try {
    for (const product of products) {
      const match = await findBestImageMatch(client, product);
      if (!match?.image_id) continue;

      const packageSize = product.packageSize ?? match.unit_quantity ?? null;
      await prisma.product.update({
        where: { id: product.id },
        data: {
          picnicImageId: match.image_id,
          packageSize,
          packageQuantity:
            product.packageQuantity ?? (packageSize ? parsePackageQuantity(packageSize, product.unit) : null),
          price: product.price ?? picnicPriceToEuros(match.display_price ?? match.price),
          lastSeenAvailable: new Date(),
        },
      });
      updated += 1;
    }

    const refreshedToken = client.getAuthToken();
    if (refreshedToken && refreshedToken !== household.picnicAuthToken) {
      await prisma.household.update({
        where: { id: householdId },
        data: { picnicAuthToken: refreshedToken, picnicTokenUpdatedAt: new Date() },
      });
    }
  } catch (error) {
    console.warn("Picnic product image enrichment skipped", error);
  }

  return { attempted: products.length, updated };
}
