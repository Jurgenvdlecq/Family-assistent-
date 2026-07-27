import type { PicnicSearchResultItem } from "./searchResults";

export function picnicImageUrl(imageId: string | null | undefined, size: "small" | "medium" | "large" = "medium") {
  if (!imageId) return null;
  return `https://storefront-prod.nl.picnicinternational.com/static/images/${imageId}/${size}.png`;
}

export function picnicProductRef(item: Pick<PicnicSearchResultItem, "id" | "sole_article_id">) {
  return item.sole_article_id ?? item.id ?? null;
}

export function picnicPriceToEuros(price: number | null | undefined) {
  if (price == null) return null;
  return Math.round(price) / 100;
}
