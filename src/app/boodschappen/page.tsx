import { redirect } from "next/navigation";
import Link from "next/link";
import { after } from "next/server";
import { ChevronLeft, ShoppingCart, CheckCircle2, Utensils, ChevronRight, Search, ClipboardList } from "lucide-react";
import { requireCurrentHousehold } from "@/lib/auth";
import { getMealPlanForWeek } from "@/lib/mealPlan";
import { DAY_KEY_BY_ENUM, DAY_LABELS, getCurrentWeekStart } from "@/lib/week";
import { describeLinePackaging, ensureShoppingList } from "@/lib/shoppingList";
import { prisma } from "@/lib/prisma";
import { getHouseholdPortionScaleByDay } from "@/lib/household";
import { getFixedGroceries } from "@/lib/fixedGroceries";
import { getInventoryChecklist } from "@/lib/inventory";
import { enrichShoppingListProductImages } from "@/lib/picnic/productEnrichment";
import { picnicImageUrl, picnicPriceToEuros, picnicProductRef } from "@/lib/picnic/products";
import { PicnicClient } from "@/lib/picnic/client";
import type { PicnicSearchResultItem } from "@/lib/picnic/searchResults";
import { inferFixedProductOrderQuantity, parseBulkFixedGroceryInput } from "@/lib/fixedGroceryProductChoice";
import NavBar from "@/components/NavBar";
import PicnicTransfer from "./PicnicTransfer";
import AddToPicnicCart from "./AddToPicnicCart";
import {
  removeFixedLineThisWeek,
  restoreFixedLineThisWeek,
  updateFixedLineQuantity,
  addFixedPicnicProduct,
  addBulkFixedPicnicProducts,
  removeFixedGroceryPermanently,
} from "./fixedGroceriesActions";
import { updateInventoryStatus } from "./inventoryActions";

const UNIT_LABELS: Record<string, string> = { GRAM: "gram", ML: "ml", PIECE: "stuks" };

const INVENTORY_STATUS_OPTIONS = [
  { value: "SUFFICIENT", label: "Genoeg" },
  { value: "LOW", label: "Bijna op" },
  { value: "OUT_OF_STOCK", label: "Op" },
] as const;

// ensureShoppingList schrijft (idempotent) naar de database — nooit
// statisch prerenderen tijdens de build.
export const dynamic = "force-dynamic";

function formatQuantity(quantity: number, unit: string) {
  if (unit === "GRAM") return `${quantity} g`;
  if (unit === "ML") return `${quantity} ml`;
  return `${quantity}x`;
}

function formatOrderQuantity(line: {
  quantity: number;
  unit: string;
  source: string;
  product: { packageQuantity: number | null; packageSize: string | null } | null;
}) {
  if (line.source === "FIXED" && line.unit === "PIECE") return `${line.quantity}x`;

  const packaging = describeLinePackaging(
    { quantity: line.quantity, unit: line.unit as "GRAM" | "ML" | "PIECE" },
    line.product
  );
  if (packaging.status === "OK") return `${packaging.packagesToBuy}x`;
  return formatQuantity(line.quantity, line.unit);
}

function fixedLineEditQuantity(line: {
  quantity: number;
  unit: string;
  product: { packageQuantity: number | null } | null;
}) {
  if (line.unit === "PIECE") return { quantity: line.quantity, unit: "PIECE" };
  if (line.product?.packageQuantity && line.product.packageQuantity > 0) {
    return { quantity: Math.ceil(line.quantity / line.product.packageQuantity), unit: "PIECE" };
  }
  return { quantity: line.quantity, unit: line.unit };
}

function ProductThumb({
  line,
}: {
  line: { ingredient: { name: string }; product: { name: string; picnicImageId: string | null } | null };
}) {
  const imageUrl = picnicImageUrl(line.product?.picnicImageId, "small");
  return (
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-line bg-white bg-contain bg-center bg-no-repeat text-ink-faint"
      style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}
      aria-label={line.product?.name ?? line.ingredient.name}
    >
      {!imageUrl && <ShoppingCart size={16} />}
    </div>
  );
}

function ProductImage({
  product,
  label,
}: {
  product: { name: string; picnicImageId: string | null } | null | undefined;
  label: string;
}) {
  const imageUrl = picnicImageUrl(product?.picnicImageId, "small");
  return (
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-line bg-white bg-contain bg-center bg-no-repeat text-ink-faint"
      style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}
      aria-label={product?.name ?? label}
    >
      {!imageUrl && <ShoppingCart size={16} />}
    </div>
  );
}

type FixedProductResult = PicnicSearchResultItem & {
  externalRef: string;
  fixedQuantity: number;
  fixedUnit: "GRAM" | "ML" | "PIECE";
};

type BulkFixedProductResult = FixedProductResult & {
  suggestedQuantity: number;
};

type BulkFixedPreviewLine = {
  raw: string;
  searchTerm: string;
  multiplier: number;
  results: BulkFixedProductResult[];
};

function preparePicnicTransferText(lines: Array<{
  ingredient: { name: string };
  product: { name: string; packageSize: string | null } | null;
}>) {
  return lines
    .map((line) => {
      const label = line.product?.name ?? line.ingredient.name;
      const detail = line.product?.packageSize ? ` (${line.product.packageSize})` : "";
      return `- ${label}${detail}`;
    })
    .join("\n");
}

function describePackage(product: { packageSize: string | null } | null | undefined) {
  return product?.packageSize ?? "Verpakking onbekend";
}

async function searchFixedProductResults(householdId: string, token: string, query: string) {
  const client = new PicnicClient(token);
  const results = await client.search(query);
  const refreshedToken = client.getAuthToken();
  if (refreshedToken && refreshedToken !== token) {
    await prisma.household.update({
      where: { id: householdId },
      data: { picnicAuthToken: refreshedToken, picnicTokenUpdatedAt: new Date() },
    });
  }

  return results
    .map((item): FixedProductResult | null => {
      const externalRef = picnicProductRef(item);
      if (!externalRef || !item.name) return null;
      const inferred = inferFixedProductOrderQuantity();
      return { ...item, externalRef, fixedQuantity: inferred.quantity, fixedUnit: inferred.unit };
    })
    .filter((item) => item !== null)
    .slice(0, 8);
}

async function searchBulkFixedProductResults(householdId: string, token: string, bulkText: string): Promise<BulkFixedPreviewLine[]> {
  const parsedLines = parseBulkFixedGroceryInput(bulkText).slice(0, 20);
  if (parsedLines.length === 0) return [];

  const client = new PicnicClient(token);
  const previews: BulkFixedPreviewLine[] = [];
  try {
    for (const line of parsedLines) {
      const results = await client.search(line.searchTerm);
      const seenRefs = new Set<string>();
      const productResults = results
        .map((item): BulkFixedProductResult | null => {
          const externalRef = picnicProductRef(item);
          if (!externalRef || !item.name || seenRefs.has(externalRef)) return null;
          seenRefs.add(externalRef);
          const inferred = inferFixedProductOrderQuantity(line.multiplier);
          return {
            ...item,
            externalRef,
            fixedQuantity: inferred.quantity,
            fixedUnit: inferred.unit,
            suggestedQuantity: inferred.quantity,
          };
        })
        .filter((item) => item !== null)
        .slice(0, 3);
      previews.push({ ...line, results: productResults });
    }
  } finally {
    const refreshedToken = client.getAuthToken();
    if (refreshedToken && refreshedToken !== token) {
      await prisma.household.update({
        where: { id: householdId },
        data: { picnicAuthToken: refreshedToken, picnicTokenUpdatedAt: new Date() },
      });
    }
  }

  return previews;
}

function FixedProductImage({ item }: { item: { image_id?: string; name?: string } }) {
  const imageUrl = picnicImageUrl(item.image_id, "small");
  return (
    <div
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-line bg-white bg-contain bg-center bg-no-repeat text-ink-faint"
      style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}
      aria-label={item.name ?? "Picnic-product"}
    >
      {!imageUrl && <ShoppingCart size={17} />}
    </div>
  );
}

export default async function BoodschappenPage({
  searchParams,
}: {
  searchParams: Promise<{ fixedQ?: string; fixedLine?: string; fixedReplaceLineId?: string; bulkFixed?: string }>;
}) {
  const params = await searchParams;
  const household = await requireCurrentHousehold();
  const fixedSearchQuery = String(params.fixedQ ?? "").trim();
  const bulkFixedText = String(params.bulkFixed ?? "").trim();
  const focusedFixedLineId = String(params.fixedLine ?? "").trim();
  const fixedReplaceLineId = String(params.fixedReplaceLineId ?? "").trim();

  const weekStart = getCurrentWeekStart();
  const mealPlan = await getMealPlanForWeek(household.id, weekStart);
  if (!mealPlan) redirect("/");

  const shoppingList = await ensureShoppingList(mealPlan.id, household.id);
  if (shoppingList.lines.some((line) => line.product && !line.product.picnicImageId)) {
    after(() => enrichShoppingListProductImages(household.id, shoppingList.id));
  }
  const sortedLines = [...shoppingList.lines].sort((a, b) =>
    a.ingredient.name.localeCompare(b.ingredient.name)
  );
  const mealLines = sortedLines.filter((l) => l.source === "MEAL" || l.source === "INVENTORY");
  const activeFixedLines = sortedLines.filter((l) => l.source === "FIXED");
  const fixedReplacementLine = activeFixedLines.find((line) => line.id === fixedReplaceLineId);
  const reviewCount = sortedLines.filter((l) => l.needsReview).length;
  const picnicTransfer = {
    text: preparePicnicTransferText(sortedLines),
    itemCount: sortedLines.length,
    status: shoppingList.status,
  };

  const [fixedGroceries, inventoryChecklist, fixedProductResults, bulkFixedPreviewLines, portionScaleByDay] = await Promise.all([
    getFixedGroceries(household.id),
    getInventoryChecklist(household.id),
    fixedSearchQuery && household.picnicAuthToken
      ? searchFixedProductResults(household.id, household.picnicAuthToken, fixedSearchQuery)
      : Promise.resolve([]),
    bulkFixedText && household.picnicAuthToken
      ? searchBulkFixedProductResults(household.id, household.picnicAuthToken, bulkFixedText)
      : Promise.resolve([]),
    getHouseholdPortionScaleByDay(household.id),
  ]);
  const activeIngredientIds = new Set(activeFixedLines.map((l) => l.ingredientId));
  const inactiveFixedItems = fixedGroceries.filter((f) => !activeIngredientIds.has(f.ingredientId));
  const mealLineByIngredientId = new Map(mealLines.map((line) => [line.ingredientId, line]));
  const mealReviewIds = new Set(mealLines.filter((line) => line.needsReview).map((line) => line.ingredientId));
  const dayReviewCounts = new Map(
    mealPlan.entries.map((entry) => [
      entry.id,
      entry.recipeVariant.recipe.ingredients.filter((ri) => mealReviewIds.has(ri.ingredientId)).length,
    ])
  );

  return (
    <div className="mx-auto flex min-h-screen w-full min-w-0 max-w-2xl flex-col pb-24">
      <header className="flex items-center justify-between px-6 pt-6 pb-2">
        <Link href="/" aria-label="Terug naar Jouw week" className="text-ink-muted">
          <ChevronLeft size={22} />
        </Link>
        <span className="text-sm font-semibold">Boodschappen</span>
        <ShoppingCart size={18} className="text-ink-muted" />
      </header>

      <div className="min-w-0 px-6 pt-4">
        <h1 className="mb-1 flex items-center gap-2 text-[1.6rem] font-semibold leading-tight text-ink">
          Jullie boodschappen staan klaar
          <CheckCircle2 size={22} className="shrink-0 text-tag-green-ink" />
        </h1>
        <div className="mb-6 flex flex-wrap items-center gap-4 text-sm text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <Utensils size={14} className="text-ink-faint" />
            {mealPlan.entries.length} maaltijden
          </span>
          <span>{sortedLines.length} producten</span>
        </div>

        {reviewCount > 0 && (
          <Link
            href="/controle"
            className="mb-6 flex items-center justify-between rounded-xl border border-tag-amber-ink/25 bg-tag-amber-bg px-4 py-3 text-sm font-medium text-tag-amber-ink"
          >
            <span>{reviewCount} product(en) vragen jullie aandacht</span>
            <ChevronRight size={16} />
          </Link>
        )}
      </div>

      <div className="min-w-0 px-6">
        <section className="mb-8 min-w-0">
          <h2 className="mb-3 text-sm font-semibold text-ink">Per dag controleren</h2>
          <div className="grid gap-4">
            {mealPlan.entries.map((entry) => {
              const dayKey = DAY_KEY_BY_ENUM[entry.dayOfWeek];
              const scale = portionScaleByDay[dayKey]?.scale ?? 1;
              const dayReviewCount = dayReviewCounts.get(entry.id) ?? 0;
              return (
                <article key={entry.id} className="rounded-xl border border-line bg-surface p-4">
                  <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium uppercase tracking-wide text-accent">{DAY_LABELS[dayKey]}</p>
                      <h3 className="mt-0.5 line-clamp-2 font-semibold text-ink">
                        {entry.recipeVariant.recipe.title}
                      </h3>
                      <p className="mt-1 text-xs text-ink-faint">
                        {scale === 1 ? "Normale porties" : `${Math.round(scale * 100)}% van normale porties`}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          dayReviewCount > 0
                            ? "bg-tag-amber-bg text-tag-amber-ink"
                            : "bg-tag-green-bg text-tag-green-ink"
                        }`}
                      >
                        {dayReviewCount > 0 ? `${dayReviewCount} controleren` : "Compleet"}
                      </span>
                      <Link
                        href={`/gerechten?day=${dayKey}`}
                        className="text-xs font-medium text-accent underline decoration-dotted"
                      >
                        Ander gerecht
                      </Link>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    {entry.recipeVariant.recipe.ingredients.map((ri) => {
                      const line = mealLineByIngredientId.get(ri.ingredientId);
                      const scaledNeed = { quantity: ri.quantity * scale, unit: ri.unit };
                      return (
                        <div
                          key={ri.id}
                          className="rounded-lg border border-line bg-surface-2 p-3"
                        >
                          <div className="flex min-w-0 items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <ProductImage product={line?.product} label={ri.ingredient.name} />
                              <div className="min-w-0">
                                <p className="line-clamp-2 text-sm font-medium text-ink">
                                  {line?.product?.name ?? ri.ingredient.name}
                                </p>
                                <p className="mt-0.5 text-xs text-ink-faint">
                                  {describePackage(line?.product)}
                                </p>
                                <p className="mt-0.5 text-[11px] text-ink-faint">
                                  Voor dit gerecht: {formatQuantity(scaledNeed.quantity, scaledNeed.unit)}
                                </p>
                                {line?.needsReview && (
                                  <p className="mt-1 text-xs font-medium text-tag-amber-ink">Nog te bevestigen</p>
                                )}
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="font-semibold text-ink">{line ? formatOrderQuantity(line) : "?"}</p>
                              {line ? (
                                <Link
                                  href={`/controle?focus=${line.id}#line-${line.id}`}
                                  className="mt-1 block text-xs font-medium text-accent underline decoration-dotted"
                                >
                                  Product
                                </Link>
                              ) : (
                                <Link
                                  href="/controle"
                                  className="mt-1 block text-xs font-medium text-tag-amber-ink underline decoration-dotted"
                                >
                                  Controleren
                                </Link>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <h2 className="mb-3 text-sm font-semibold text-ink">Totaalbestelling</h2>
        <div className="flex min-w-0 flex-col divide-y divide-line rounded-xl border border-line bg-surface">
          {mealLines.map((line) => (
            <div key={line.id} className="flex min-w-0 items-center justify-between gap-4 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <ProductThumb line={line} />
                <div className="min-w-0">
                  <p className="truncate text-ink">{line.product?.name ?? line.ingredient.name}</p>
                  {line.product?.brand && (
                    <p className="truncate text-xs text-ink-faint">
                      {line.product.brand}
                      {line.product.packageSize ? ` · ${line.product.packageSize}` : ""}
                    </p>
                  )}
                  {line.needsReview && (
                    <p className="mt-0.5 text-xs font-medium text-tag-amber-ink">Nog te bevestigen</p>
                  )}
                </div>
              </div>
              <span className="shrink-0 text-sm text-ink-muted">
                {formatOrderQuantity(line)}
              </span>
            </div>
          ))}
        </div>

        <details
          id="fixed-groceries"
          className="mt-8 scroll-mt-6 rounded-xl border border-line bg-surface p-4"
          open={focusedFixedLineId || fixedReplaceLineId ? true : undefined}
        >
          <summary className="cursor-pointer text-sm font-semibold text-ink">
            {activeFixedLines.length + inactiveFixedItems.length} vaste boodschap
            {activeFixedLines.length + inactiveFixedItems.length === 1 ? "" : "pen"}
          </summary>
          <div className="mt-3 flex min-w-0 flex-col divide-y divide-line">
          {activeFixedLines.length === 0 && inactiveFixedItems.length === 0 && (
            <p className="p-4 text-sm text-ink-muted">
              Nog geen vaste boodschappen ingesteld — voeg hieronder je eerste toe.
            </p>
          )}
          {activeFixedLines.map((line) => {
            const editQuantity = fixedLineEditQuantity(line);
            return (
              <div
                key={line.id}
                id={`fixed-line-${line.id}`}
                className="flex min-w-0 scroll-mt-6 flex-col gap-2 p-4 transition-colors target:bg-accent/10"
              >
              <div className="flex min-w-0 items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="min-w-0 truncate text-ink">{line.product?.name ?? line.ingredient.name}</p>
                  {line.product?.packageSize && (
                    <p className="mt-0.5 text-xs text-ink-faint">{line.product.packageSize}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <form action="/boodschappen#add-fixed-grocery">
                    <input type="hidden" name="fixedQ" value={line.ingredient.name} />
                    <input type="hidden" name="fixedReplaceLineId" value={line.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink transition-colors hover:border-accent/60 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.98]"
                    >
                      Wijzigen
                    </button>
                  </form>
                  <form action={removeFixedLineThisWeek}>
                    <input type="hidden" name="lineId" value={line.id} />
                    <button
                      type="submit"
                      className="shrink-0 text-xs font-medium text-ink-faint transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.98]"
                    >
                      Deze week niet nodig
                    </button>
                  </form>
                </div>
              </div>
              <form action={updateFixedLineQuantity} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="lineId" value={line.id} />
                <input
                  type="number"
                  name="quantity"
                  defaultValue={editQuantity.quantity}
                  step="any"
                  min="0.01"
                  className="w-20 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
                />
                <input type="hidden" name="unit" value={editQuantity.unit} />
                <span className="text-xs text-ink-faint">{UNIT_LABELS[editQuantity.unit] ?? editQuantity.unit}</span>
                <label className="flex items-center gap-1 text-xs text-ink-muted">
                  <input type="checkbox" name="rememberAsDefault" value="true" />
                  onthouden
                </label>
                <button
                  type="submit"
                  className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:border-accent/50"
                >
                  Bijwerken
                </button>
              </form>
              </div>
            );
          })}
          {inactiveFixedItems.map((item) => (
            <div key={item.id} className="flex min-w-0 items-center justify-between gap-3 p-4">
              <p className="min-w-0 truncate text-ink-faint line-through">{item.ingredient.name}</p>
              <div className="flex shrink-0 items-center gap-3">
                <form action={restoreFixedLineThisWeek}>
                  <input type="hidden" name="shoppingListId" value={shoppingList.id} />
                  <input type="hidden" name="ingredientId" value={item.ingredientId} />
                  <button type="submit" className="text-xs font-medium text-accent hover:opacity-80">
                    Toch toevoegen
                  </button>
                </form>
                <form action={removeFixedGroceryPermanently}>
                  <input type="hidden" name="householdId" value={household.id} />
                  <input type="hidden" name="ingredientId" value={item.ingredientId} />
                  <button type="submit" className="text-xs font-medium text-ink-faint hover:text-red-600">
                    Verwijder voorgoed
                  </button>
                </form>
              </div>
            </div>
          ))}
          </div>
        </details>

        <details
          id="add-fixed-grocery"
          className="mt-4 scroll-mt-6 rounded-xl border border-line bg-surface p-4"
          open={fixedSearchQuery || fixedReplaceLineId || bulkFixedText ? true : undefined}
        >
          <summary className="cursor-pointer text-sm font-medium text-ink">
            {fixedReplacementLine ? "Vaste boodschap wijzigen" : "Nieuwe vaste boodschap toevoegen"}
          </summary>

          {!fixedReplacementLine && (
            <section id="bulk-fixed-groceries" className="mt-4 rounded-lg border border-line bg-surface-2 p-3">
              <div className="mb-3 flex items-start gap-2">
                <ClipboardList size={17} className="mt-0.5 shrink-0 text-accent" />
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-ink">Plak je vaste boodschappenlijst</h2>
                  <p className="mt-1 text-xs text-ink-muted">
                    Zet producten onder elkaar of scheid ze met komma&rsquo;s. Ik zoek ze daarna per regel op bij Picnic.
                  </p>
                </div>
              </div>
              <form action="/boodschappen#bulk-fixed-groceries" className="grid gap-2">
                <textarea
                  name="bulkFixed"
                  defaultValue={bulkFixedText}
                  rows={4}
                  placeholder={"2 pakken magere melk\ndrinkyoghurt framboos\nbananen\nappels"}
                  className="min-h-28 min-w-0 resize-y rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                />
                <button
                  type="submit"
                  className="w-fit rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent/90"
                >
                  Zoek mijn lijst
                </button>
              </form>

              {bulkFixedText && !household.picnicAuthToken && (
                <p className="mt-3 text-sm text-ink-muted">
                  Koppel eerst Picnic om een hele lijst automatisch op te zoeken.
                </p>
              )}

              {bulkFixedPreviewLines.length > 0 && (
                <div className="mt-4 grid gap-4">
                  <form action={addBulkFixedPicnicProducts} className="rounded-lg border border-accent/30 bg-accent-soft p-3">
                    <input type="hidden" name="householdId" value={household.id} />
                    {bulkFixedPreviewLines
                      .filter((line) => line.results[0])
                      .map((line) => {
                        const item = line.results[0]!;
                        return (
                          <input
                            key={`${line.raw}-${item.externalRef}`}
                            type="hidden"
                            name="choice"
                            value={JSON.stringify({
                              householdId: household.id,
                              shoppingListId: shoppingList.id,
                              searchTerm: line.searchTerm,
                              productName: item.name ?? "",
                              externalRef: item.externalRef,
                              packageSize: item.unit_quantity ?? "",
                              picnicImageId: item.image_id ?? "",
                              quantity: item.suggestedQuantity,
                              unit: item.fixedUnit,
                              price: picnicPriceToEuros(item.display_price ?? item.price),
                            })}
                          />
                        );
                      })}
                    <button
                      type="submit"
                      className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent/90"
                    >
                      Beste keuzes opslaan
                    </button>
                    <p className="mt-2 text-xs text-ink-muted">
                      Controleer hieronder of de beste keuze per regel klopt. Afwijkingen kun je los kiezen.
                    </p>
                  </form>

                  {bulkFixedPreviewLines.map((line) => (
                    <div key={line.raw} className="rounded-lg border border-line bg-surface p-3">
                      <div className="mb-3">
                        <p className="text-sm font-semibold text-ink">{line.raw}</p>
                        <p className="text-xs text-ink-faint">
                          Zoekterm: {line.searchTerm}
                          {line.multiplier !== 1 ? ` · aantal/verpakking: ${line.multiplier}x` : ""}
                        </p>
                      </div>
                      {line.results.length === 0 ? (
                        <p className="text-sm text-ink-muted">Geen Picnic-product gevonden. Probeer deze regel los te zoeken.</p>
                      ) : (
                        <div className="grid gap-2">
                          {line.results.map((item, index) => (
                            <form key={item.externalRef} action={addFixedPicnicProduct} className="rounded-lg border border-line p-3">
                              <input type="hidden" name="householdId" value={household.id} />
                              <input type="hidden" name="shoppingListId" value={shoppingList.id} />
                              <input type="hidden" name="searchTerm" value={line.searchTerm} />
                              <input type="hidden" name="externalRef" value={item.externalRef} />
                              <input type="hidden" name="productName" value={item.name ?? ""} />
                              <input type="hidden" name="packageSize" value={item.unit_quantity ?? ""} />
                              <input type="hidden" name="picnicImageId" value={item.image_id ?? ""} />
                              <input type="hidden" name="price" value={picnicPriceToEuros(item.display_price ?? item.price) ?? ""} />
                              <input type="hidden" name="bulkFixed" value={bulkFixedText} />
                              <div className="flex min-w-0 gap-3">
                                <FixedProductImage item={item} />
                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="line-clamp-2 text-sm font-medium text-ink">
                                        {index === 0 ? "Beste keuze: " : ""}
                                        {item.name}
                                      </p>
                                      <p className="text-xs text-ink-faint">{item.unit_quantity ?? "Geen verpakkingsinfo"}</p>
                                    </div>
                                    <span className="shrink-0 text-sm font-semibold text-ink">
                                      {picnicPriceToEuros(item.display_price ?? item.price) != null
                                        ? `€ ${picnicPriceToEuros(item.display_price ?? item.price)!.toFixed(2)}`
                                        : "Prijs onbekend"}
                                    </span>
                                  </div>
                                  <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <input
                                      type="number"
                                      name="quantity"
                                      defaultValue={item.suggestedQuantity}
                                      min="0.01"
                                      step="any"
                                      className="w-24 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                                    />
                                    <select
                                      name="unit"
                                      defaultValue={item.fixedUnit}
                                      className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                                    >
                                      <option value="PIECE">stuks</option>
                                      <option value="GRAM">gram</option>
                                      <option value="ML">ml</option>
                                    </select>
                                    <button
                                      type="submit"
                                      className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-accent/70 hover:bg-surface-2"
                                    >
                                      Deze opslaan
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </form>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <form action="/boodschappen#add-fixed-grocery" className="mt-3 flex min-w-0 gap-2">
            {fixedReplaceLineId && (
              <input type="hidden" name="fixedReplaceLineId" value={fixedReplaceLineId} />
            )}
            <input
              name="fixedQ"
              defaultValue={fixedSearchQuery}
              placeholder="Zoek Picnic-product, bv. appels"
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <button
              type="submit"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink transition-colors hover:border-accent/70 hover:bg-surface-2"
              aria-label="Zoeken bij Picnic"
              title="Zoeken bij Picnic"
            >
              <Search size={16} />
            </button>
          </form>

          {fixedReplacementLine && (
            <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-muted">
              Je wijzigt nu:{" "}
              <span className="font-medium text-ink">
                {fixedReplacementLine.product?.name ?? fixedReplacementLine.ingredient.name}
              </span>
              . Kies hieronder het product dat voortaan standaard gebruikt moet worden.
            </p>
          )}

          {!household.picnicAuthToken && (
            <p className="mt-3 text-sm text-ink-muted">
              Koppel eerst Picnic om live producten te zoeken.
            </p>
          )}

          {fixedSearchQuery && household.picnicAuthToken && fixedProductResults.length === 0 && (
            <p className="mt-3 text-sm text-ink-muted">
              Geen Picnic-producten gevonden voor {fixedSearchQuery}. Probeer een andere zoekterm.
            </p>
          )}

          {fixedProductResults.length > 0 && (
            <div className="mt-4 grid gap-2">
              {fixedProductResults.map((item) => (
                <form key={item.externalRef} action={addFixedPicnicProduct} className="rounded-lg border border-line p-3">
                  <input type="hidden" name="householdId" value={household.id} />
                  <input type="hidden" name="shoppingListId" value={shoppingList.id} />
                  {fixedReplaceLineId && (
                    <input type="hidden" name="replaceLineId" value={fixedReplaceLineId} />
                  )}
                  <input type="hidden" name="searchTerm" value={fixedSearchQuery} />
                  <input type="hidden" name="externalRef" value={item.externalRef} />
                  <input type="hidden" name="productName" value={item.name ?? ""} />
                  <input type="hidden" name="packageSize" value={item.unit_quantity ?? ""} />
                  <input type="hidden" name="picnicImageId" value={item.image_id ?? ""} />
                  <input type="hidden" name="price" value={picnicPriceToEuros(item.display_price ?? item.price) ?? ""} />

                  <div className="flex min-w-0 gap-3">
                    <FixedProductImage item={item} />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="line-clamp-2 text-sm font-medium text-ink">{item.name}</p>
                          <p className="text-xs text-ink-faint">{item.unit_quantity ?? "Geen verpakkingsinfo"}</p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold text-ink">
                          {picnicPriceToEuros(item.display_price ?? item.price) != null
                            ? `€ ${picnicPriceToEuros(item.display_price ?? item.price)!.toFixed(2)}`
                            : "Prijs onbekend"}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <input
                          type="number"
                          name="quantity"
                          defaultValue={item.fixedQuantity}
                          min="0.01"
                          step="any"
                          className="w-24 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                        />
                        <select
                          name="unit"
                          defaultValue={item.fixedUnit}
                          className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                        >
                          <option value="PIECE">stuks</option>
                          <option value="GRAM">gram</option>
                          <option value="ML">ml</option>
                        </select>
                        <button
                          type="submit"
                          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent/90"
                        >
                          {fixedReplacementLine ? "Vervang vaste boodschap" : "Kies als vaste boodschap"}
                        </button>
                      </div>
                    </div>
                  </div>
                </form>
              ))}
            </div>
          )}
        </details>

        <details className="mt-6 rounded-xl border border-line bg-surface p-4">
          <summary className="cursor-pointer text-sm font-semibold text-ink">
            Voorraadcheck voor {inventoryChecklist.length} basisproducten
          </summary>
          <p className="mt-2 text-sm text-ink-muted">
            Hoe staat het met deze basisproducten? Ik onthoud je antwoord voor volgende keren.
          </p>
          <div className="mt-3 flex min-w-0 flex-col divide-y divide-line">
          {inventoryChecklist.map((item) => (
            <div
              key={item.ingredientId}
              className="flex min-w-0 flex-wrap items-center justify-between gap-2 p-4"
            >
              <p className="min-w-0 truncate text-ink">{item.name}</p>
              <div className="flex shrink-0 gap-1 rounded-lg bg-surface-2 p-1">
                {INVENTORY_STATUS_OPTIONS.map((option) => (
                  <form key={option.value} action={updateInventoryStatus}>
                    <input type="hidden" name="householdId" value={household.id} />
                    <input type="hidden" name="ingredientId" value={item.ingredientId} />
                    <input type="hidden" name="status" value={option.value} />
                    <button
                      type="submit"
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        item.status === option.value
                          ? "bg-accent text-accent-ink"
                          : "text-ink-muted hover:text-ink"
                      }`}
                    >
                      {option.label}
                    </button>
                  </form>
                ))}
              </div>
            </div>
          ))}
          </div>
        </details>

        {!household.picnicAuthToken && (
          <PicnicTransfer
            shoppingListId={shoppingList.id}
            text={picnicTransfer.text}
            itemCount={picnicTransfer.itemCount}
            transferred={picnicTransfer.status === "TRANSFERRED"}
          />
        )}
        <AddToPicnicCart
          shoppingListId={shoppingList.id}
          connected={Boolean(household.picnicAuthToken)}
        />
      </div>

      <NavBar />
    </div>
  );
}
