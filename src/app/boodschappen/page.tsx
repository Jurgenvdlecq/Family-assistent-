import { redirect } from "next/navigation";
import Link from "next/link";
import { after } from "next/server";
import { ChevronLeft, ShoppingCart, CheckCircle2, Utensils, ChevronRight, Search, ClipboardList, Minus, Plus, X } from "lucide-react";
import { requireCurrentHousehold } from "@/lib/auth";
import { getMealPlanForWeek } from "@/lib/mealPlan";
import { DAY_KEY_BY_ENUM, DAY_LABELS, getCurrentWeekStart } from "@/lib/week";
import {
  describeLinePackaging,
  ensureShoppingList,
  findShoppingListShortfalls,
  getShoppingListCandidatesByIngredient,
  isUserChosenPackageCount,
} from "@/lib/shoppingList";
import { prisma } from "@/lib/prisma";
import { getHouseholdPortionScaleByDay } from "@/lib/household";
import { getFixedGroceries } from "@/lib/fixedGroceries";
import { getInventoryChecklist, getInventoryMap } from "@/lib/inventory";
import { enrichShoppingListProductImages } from "@/lib/picnic/productEnrichment";
import { picnicImageUrl, picnicPriceToEuros, picnicProductRef } from "@/lib/picnic/products";
import { PicnicClient } from "@/lib/picnic/client";
import type { PicnicSearchResultItem } from "@/lib/picnic/searchResults";
import { inferFixedProductOrderQuantity, parseBulkFixedGroceryInput, titleCaseSearchTerm } from "@/lib/fixedGroceryProductChoice";
import { getTrustedPreferences } from "@/domain/product-matching/repository";
import NavBar from "@/components/NavBar";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import PicnicTransfer from "./PicnicTransfer";
import AddToPicnicCart from "./AddToPicnicCart";
import PicnicDeliveryStatusCard from "./PicnicDeliveryStatusCard";
import ShoppingChecklist, { type ChecklistLine } from "./ShoppingChecklist";
import {
  acknowledgeShoppingListShortfall,
  adjustBoodschappenLineQuantity,
  chooseBoodschappenProduct,
  fillShoppingListShortfall,
  removeBoodschappenLineThisWeek,
  setBoodschappenLinePackageCount,
} from "./actions";
import {
  removeFixedLineThisWeek,
  restoreFixedLineThisWeek,
  updateFixedLineQuantity,
  addFixedPicnicProduct,
  addBulkFixedPicnicProducts,
  removeFixedGroceryPermanently,
} from "./fixedGroceriesActions";
import { addManualProduct } from "./manualProductActions";
import { addQuickOrderPickedProducts, addQuickOrderTrustedProducts } from "./quickOrderActions";
import { updateInventoryStatus } from "./inventoryActions";
import LooseListCard from "./LooseListCard";

const UNIT_LABELS: Record<string, string> = { GRAM: "gram", ML: "ml", PIECE: "stuks" };
const ACTION_BUTTON_FOCUS =
  "shadow-sm transition-all duration-150 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:translate-y-0 active:scale-[0.98]";

const STATUS_MESSAGES: Record<string, string> = {
  remembered: "Opgeslagen en onthouden voor volgende keer.",
  "week-only": "Gekozen voor deze week.",
  quantity: "Weekaantal bijgewerkt.",
  "shortfall-filled": "Aangevuld tot de benodigde hoeveelheid.",
  "shortfall-accepted": "Oké, dat laten we deze week zo.",
  "fixed-added": "Vaste boodschap toegevoegd.",
  "fixed-bulk-added": "Vaste boodschappen opgeslagen.",
  "fixed-disabled": "Vaste boodschap staat deze week uit.",
  "fixed-restored": "Vaste boodschap weer toegevoegd voor deze week.",
  "fixed-quantity": "Vaste boodschap bijgewerkt voor deze week.",
  "fixed-quantity-remembered": "Vaste boodschap bijgewerkt en onthouden.",
  "fixed-replaced": "Vaste boodschap vervangen.",
  "fixed-removed": "Vaste boodschap verwijderd.",
  "inventory-updated": "Voorraadstatus opgeslagen.",
  "manual-added": "Toegevoegd aan de lijst van deze week.",
  "quick-order-added": "Toegevoegd aan de lijst van deze week.",
  "quick-order-bulk-added": "Herkende producten toegevoegd aan de lijst van deze week.",
  "loose-list-started": "Losse boodschappenlijst gestart — het weekmenu van deze week staat op \"uit eten\".",
  "loose-list-week-changed": "De week is inmiddels doorgesprongen naar een nieuwe — herlaad de pagina en probeer het opnieuw.",
  "shopping-reviewed": "Lijst bevestigd — klaar om naar Picnic te gaan.",
  "line-in-picnic-cart":
    "Dit product ligt al in je Picnic-mandje, dus ik kan het hier niet van de lijst halen. Leeg je Picnic-mandje hieronder als je het toch niet wilt bestellen.",
};

/** Meldingen die geen bevestiging zijn maar een blokkade/waarschuwing — amber i.p.v. groen. */
const WARNING_STATUSES = new Set(["loose-list-week-changed", "line-in-picnic-cart"]);

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
  // Stuks zijn nooit half te bestellen of te tonen als bestelaantal — ook
  // niet wanneer de verpakking onbekend is en dit de ruwe (mogelijk door
  // portieschaling gebroken) receptbehoefte is. Altijd naar boven afronden.
  return `${Math.ceil(quantity)}x`;
}

function formatOrderQuantity(line: {
  quantity: number;
  unit: string;
  source: string;
  product: { packageQuantity: number | null; packageSize: string | null } | null;
}) {
  if (isUserChosenPackageCount(line)) return `${line.quantity}x`;

  const packaging = describeLinePackaging(
    { quantity: line.quantity, unit: line.unit as "GRAM" | "ML" | "PIECE" },
    line.product
  );
  if (packaging.status === "OK") return `${packaging.packagesToBuy}x`;
  return formatQuantity(line.quantity, line.unit);
}

function formatNeededOrderQuantity(
  need: { quantity: number; unit: string },
  product: { packageQuantity: number | null; packageSize: string | null } | null | undefined
) {
  const packaging = describeLinePackaging(
    { quantity: need.quantity, unit: need.unit as "GRAM" | "ML" | "PIECE" },
    product
  );
  if (packaging.status === "OK") return `${packaging.packagesToBuy}x`;
  return formatQuantity(need.quantity, need.unit);
}

function orderPackageCount(line: {
  quantity: number;
  unit: string;
  source: string;
  product: { packageQuantity: number | null; packageSize: string | null } | null;
}) {
  if (isUserChosenPackageCount(line)) return line.quantity;
  const packaging = describeLinePackaging(
    { quantity: line.quantity, unit: line.unit as "GRAM" | "ML" | "PIECE" },
    line.product
  );
  if (packaging.status === "OK") return packaging.packagesToBuy;
  return line.quantity;
}

function formatPrice(price: unknown) {
  if (price === null || price === undefined) return null;
  return `€ ${Number(price).toFixed(2)}`;
}

function linePackageCount(line: {
  quantity: number;
  unit: string;
  source: string;
  product: { packageQuantity: number | null } | null;
}) {
  if (isUserChosenPackageCount(line)) return line.quantity;
  const packaging = describeLinePackaging(
    { quantity: line.quantity, unit: line.unit as "GRAM" | "ML" | "PIECE" },
    line.product
  );
  return packaging.status === "OK" ? packaging.packagesToBuy : 1;
}

function estimatedLineCost(line: {
  quantity: number;
  unit: string;
  source: string;
  product: { packageQuantity: number | null; price: unknown } | null;
}) {
  if (!line.product?.price) return 0;
  return linePackageCount(line) * Number(line.product.price);
}

function estimatedDayIngredientCost(
  need: { quantity: number; unit: string },
  product: { packageQuantity: number | null; price: unknown } | null | undefined
) {
  if (!product?.price) return 0;
  const packaging = describeLinePackaging(
    { quantity: need.quantity, unit: need.unit as "GRAM" | "ML" | "PIECE" },
    product
  );
  const packageCount = packaging.status === "OK" ? packaging.packagesToBuy : 1;
  return packageCount * Number(product.price);
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

type DayProduct = {
  id: string;
  name: string;
  brand: string | null;
  packageSize: string | null;
  packageQuantity: number | null;
  price: unknown;
  picnicImageId: string | null;
};

function DayProductChoice({
  line,
  product,
  selected = false,
}: {
  line: { id: string; product: DayProduct | null };
  product: DayProduct;
  selected?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-2 transition-colors ${
        selected ? "border-accent/50 bg-accent-soft" : "border-line bg-surface hover:border-accent/60 hover:bg-surface-2"
      }`}
    >
      <div className="flex min-w-0 gap-2">
        <ProductImage product={product} label={product.name} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="line-clamp-2 text-xs font-medium text-ink">{product.name}</p>
              <p className="text-[11px] text-ink-faint">
                {[product.brand, product.packageSize].filter(Boolean).join(" · ") || "Verpakking onbekend"}
              </p>
            </div>
            <span className="shrink-0 text-xs font-semibold text-ink">{formatPrice(product.price) ?? "?"}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <form action={chooseBoodschappenProduct}>
              <input type="hidden" name="lineId" value={line.id} />
              <input type="hidden" name="productId" value={product.id} />
              <PendingSubmitButton
                pendingText="Kiezen..."
                className={`rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink hover:border-accent/70 hover:bg-white ${ACTION_BUTTON_FOCUS}`}
              >
                Alleen deze week
              </PendingSubmitButton>
            </form>
            <form action={chooseBoodschappenProduct}>
              <input type="hidden" name="lineId" value={line.id} />
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="remember" value="true" />
              <PendingSubmitButton
                pendingText="Opslaan..."
                className={`rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-accent-ink hover:bg-accent/90 ${ACTION_BUTTON_FOCUS}`}
              >
                Onthouden
              </PendingSubmitButton>
            </form>
          </div>
        </div>
      </div>
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

type QuickOrderTrustedChoice = {
  searchTerm: string;
  productName: string;
  externalRef: string;
  packageSize: string | null;
  picnicImageId: string | null;
  price: number | null;
};

type QuickOrderPreviewLine = {
  raw: string;
  searchTerm: string;
  quantity: number;
  unit: "GRAM" | "ML" | "PIECE";
  /** Al eerder bewust gekozen Picnic-product voor dit ingrediënt (MATCHED_TRUSTED) — kan direct toegevoegd worden zonder te bladeren. */
  trustedChoice: QuickOrderTrustedChoice | null;
  results: BulkFixedProductResult[];
};

/**
 * WP92: "snel meerdere producten toevoegen" — voor elke regel eerst kijken
 * of DIT huishouden al zelf bewust een Picnic-product voor dit ingrediënt
 * heeft gekozen (een echte `HouseholdProductPreference`-rij) vóórdat er live
 * bij Picnic gezocht wordt. Dat is zowel sneller (geen netwerkcall nodig)
 * als precies "volgens onze wensen en voorkeuren" zoals gevraagd.
 *
 * Bewust `getTrustedPreferences` rechtstreeks, niet `matchProductForIngredient`
 * — die laatste geeft óók MATCHED_TRUSTED terug wanneer er wereldwijd maar
 * één Product-kandidaat voor een ingrediënt bestaat (Product is een gedeelde
 * catalogus, niet per huishouden), ook als dít huishouden dat product nooit
 * zelf gekozen heeft. Voor de weekmenu-lijst is dat acceptabel (blijft een
 * concept-regel die nog gecontroleerd wordt), maar hier belooft de knop
 * expliciet "jullie eerdere keuze" en voegt 'm toe zonder enige preview —
 * dat mag nooit op een toevallige wereldwijde coïncidentie berusten
 * (AGENTS.md: "nooit stilzwijgend of ongecontroleerd").
 *
 * Onbekende/twijfelachtige ingrediënten krijgen gewoon de bestaande
 * zoekresultaten-picker, net als bij vaste boodschappen.
 */
async function searchQuickOrderPreview(
  householdId: string,
  token: string | null,
  text: string
): Promise<QuickOrderPreviewLine[]> {
  const parsedLines = parseBulkFixedGroceryInput(text).slice(0, 20);
  if (parsedLines.length === 0) return [];

  let client: PicnicClient | null = null;
  const lines: QuickOrderPreviewLine[] = [];

  try {
    for (const parsed of parsedLines) {
      const inferred = inferFixedProductOrderQuantity(parsed.multiplier);
      const ingredientName = titleCaseSearchTerm(parsed.searchTerm);
      const existingIngredient = await prisma.ingredient.findUnique({ where: { name: ingredientName } });

      if (existingIngredient) {
        const trustedMap = await getTrustedPreferences(householdId, [existingIngredient.id]);
        const trusted = trustedMap.get(existingIngredient.id);
        const product = trusted ? await prisma.product.findUnique({ where: { id: trusted.productId } }) : null;
        if (product && product.externalRef) {
          lines.push({
            raw: parsed.raw,
            searchTerm: parsed.searchTerm,
            quantity: inferred.quantity,
            unit: inferred.unit,
            trustedChoice: {
              searchTerm: parsed.searchTerm,
              productName: product.name,
              externalRef: product.externalRef,
              packageSize: product.packageSize,
              picnicImageId: product.picnicImageId,
              price: product.price !== null ? Number(product.price) : null,
            },
            results: [],
          });
          continue;
        }
      }

      if (!token) {
        lines.push({
          raw: parsed.raw,
          searchTerm: parsed.searchTerm,
          quantity: inferred.quantity,
          unit: inferred.unit,
          trustedChoice: null,
          results: [],
        });
        continue;
      }

      client ??= new PicnicClient(token);
      const results = await client.search(parsed.searchTerm);
      const seenRefs = new Set<string>();
      const productResults = results
        .map((item): BulkFixedProductResult | null => {
          const externalRef = picnicProductRef(item);
          if (!externalRef || !item.name || seenRefs.has(externalRef)) return null;
          seenRefs.add(externalRef);
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

      lines.push({
        raw: parsed.raw,
        searchTerm: parsed.searchTerm,
        quantity: inferred.quantity,
        unit: inferred.unit,
        trustedChoice: null,
        results: productResults,
      });
    }
  } finally {
    if (client) {
      const refreshedToken = client.getAuthToken();
      if (refreshedToken && refreshedToken !== token) {
        await prisma.household.update({
          where: { id: householdId },
          data: { picnicAuthToken: refreshedToken, picnicTokenUpdatedAt: new Date() },
        });
      }
    }
  }

  return lines;
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

function InventoryRow({
  item,
  householdId,
  focused,
}: {
  item: { ingredientId: string; name: string; status: string };
  householdId: string;
  focused: boolean;
}) {
  return (
    <div
      id={`inventory-${item.ingredientId}`}
      className={`flex min-w-0 scroll-mt-6 flex-wrap items-center justify-between gap-2 p-4 transition-colors ${
        focused ? "bg-accent-soft" : ""
      }`}
    >
      <p className="min-w-0 truncate text-ink">{item.name}</p>
      <div className="flex shrink-0 gap-1 rounded-lg bg-surface-2 p-1">
        {INVENTORY_STATUS_OPTIONS.map((option) => (
          <form key={option.value} action={updateInventoryStatus}>
            <input type="hidden" name="householdId" value={householdId} />
            <input type="hidden" name="ingredientId" value={item.ingredientId} />
            <input type="hidden" name="status" value={option.value} />
            <button
              type="submit"
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                item.status === option.value ? "bg-accent text-accent-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}

export default async function BoodschappenPage({
  searchParams,
}: {
  searchParams: Promise<{
    fixedQ?: string;
    fixedLine?: string;
    fixedReplaceLineId?: string;
    bulkFixed?: string;
    quickOrder?: string;
    focusLine?: string;
    shortfallLine?: string;
    inventory?: string;
    manualQ?: string;
    quickOrderRaw?: string;
    status?: string;
  }>;
}) {
  const params = await searchParams;
  const household = await requireCurrentHousehold();
  const fixedSearchQuery = String(params.fixedQ ?? "").trim();
  const manualSearchQuery = String(params.manualQ ?? "").trim();
  const quickOrderRawFocus = String(params.quickOrderRaw ?? "").trim();
  const bulkFixedText = String(params.bulkFixed ?? "").trim();
  const quickOrderText = String(params.quickOrder ?? "").trim();
  const focusedFixedLineId = String(params.fixedLine ?? "").trim();
  const fixedReplaceLineId = String(params.fixedReplaceLineId ?? "").trim();
  const focusedLineId = String(params.focusLine ?? "").trim();
  const focusedShortfallLineId = String(params.shortfallLine ?? "").trim();
  const focusedInventoryId = String(params.inventory ?? "").trim();
  const generalStatusMessage =
    params.status && !focusedLineId && !focusedShortfallLineId && !focusedFixedLineId && !focusedInventoryId
      ? STATUS_MESSAGES[params.status]
      : undefined;

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
  const mealLines = sortedLines.filter(
    (l) => l.source === "MEAL" || l.source === "INVENTORY" || l.source === "MANUAL"
  );
  const activeFixedLines = sortedLines.filter((l) => l.source === "FIXED");
  const fixedReplacementLine = activeFixedLines.find((line) => line.id === fixedReplaceLineId);
  const reviewCount = sortedLines.filter((l) => l.needsReview).length;
  const picnicTransfer = {
    text: preparePicnicTransferText(sortedLines),
    itemCount: sortedLines.length,
    status: shoppingList.status,
  };
  const hasTransferredLines = sortedLines.some((line) => line.transferredToPicnicAt !== null);
  const fixedPendingCount = sortedLines.filter(
    (line) => line.source === "FIXED" && line.transferredToPicnicAt === null
  ).length;
  const manualPendingCount = sortedLines.filter(
    (line) => line.source === "MANUAL" && line.transferredToPicnicAt === null
  ).length;
  const checklistLines: ChecklistLine[] = sortedLines.map((line) => ({
    id: line.id,
    name: line.product?.name ?? line.ingredient.name,
    detail: [line.product?.brand, line.product?.packageSize].filter(Boolean).join(" · ") || null,
    quantityLabel: formatOrderQuantity(line),
    pickedUp: line.pickedUpAt !== null,
    imageUrl: picnicImageUrl(line.product?.picnicImageId, "small"),
  }));
  const checklistPickedUpCount = checklistLines.filter((line) => line.pickedUp).length;

  const [
    fixedGroceries,
    inventoryChecklist,
    fixedProductResults,
    manualProductResults,
    bulkFixedPreviewLines,
    quickOrderPreviewLines,
    portionScaleByDay,
    candidatesByIngredient,
    inventoryMap,
  ] =
    await Promise.all([
      getFixedGroceries(household.id),
      getInventoryChecklist(household.id),
      fixedSearchQuery && household.picnicAuthToken
        ? searchFixedProductResults(household.id, household.picnicAuthToken, fixedSearchQuery)
        : Promise.resolve([]),
      manualSearchQuery && household.picnicAuthToken
        ? searchFixedProductResults(household.id, household.picnicAuthToken, manualSearchQuery)
        : Promise.resolve([]),
      bulkFixedText && household.picnicAuthToken
        ? searchBulkFixedProductResults(household.id, household.picnicAuthToken, bulkFixedText)
        : Promise.resolve([]),
      quickOrderText
        ? searchQuickOrderPreview(household.id, household.picnicAuthToken, quickOrderText)
        : Promise.resolve([]),
      getHouseholdPortionScaleByDay(household.id),
      getShoppingListCandidatesByIngredient(household.id, mealLines.map((line) => line.ingredientId)),
      getInventoryMap(household.id),
    ]);
  const quickOrderAutoLines = quickOrderPreviewLines.filter((line) => line.trustedChoice);
  const quickOrderPickLines = quickOrderPreviewLines.filter((line) => !line.trustedChoice);
  const inventoryAttentionItems = inventoryChecklist.filter((item) => item.needsAttention);
  const inventoryConfirmedItems = inventoryChecklist.filter((item) => !item.needsAttention);
  const focusedInventoryIsConfirmed = inventoryConfirmedItems.some(
    (item) => item.ingredientId === focusedInventoryId
  );

  const activeIngredientIds = new Set(activeFixedLines.map((l) => l.ingredientId));
  const inactiveFixedItems = fixedGroceries.filter((f) => !activeIngredientIds.has(f.ingredientId));
  const inactiveFixedProductPreferences = inactiveFixedItems.length
    ? await prisma.householdProductPreference.findMany({
        where: { householdId: household.id, ingredientId: { in: inactiveFixedItems.map((f) => f.ingredientId) } },
        include: { product: true },
      })
    : [];
  const inactiveFixedProductByIngredientId = new Map(
    inactiveFixedProductPreferences.map((pref) => [pref.ingredientId, pref.product])
  );
  const mealLineByIngredientId = new Map(mealLines.map((line) => [line.ingredientId, line]));
  const mealTotalCost = mealLines.reduce((total, line) => total + estimatedLineCost(line), 0);
  const mealReviewIds = new Set(mealLines.filter((line) => line.needsReview).map((line) => line.ingredientId));
  const shortfallByLineId = new Map(
    findShoppingListShortfalls(mealPlan, portionScaleByDay, inventoryMap, sortedLines)
      .filter((s) => !sortedLines.find((l) => l.id === s.lineId)?.shortfallAcknowledged)
      .map((s) => [s.lineId, s])
  );
  const dayReviewCounts = new Map(
    mealPlan.entries.map((entry) => [
      entry.id,
      entry.recipeVariant.recipe.ingredients.filter((ri) => mealReviewIds.has(ri.ingredientId)).length,
    ])
  );

  // Gedeeld tussen "Jullie boodschappenlijst" (weekmenu/voorraad/handmatig)
  // en de uitklaplijst met vaste boodschappen hieronder — zelfde rij-opmaak
  // en dezelfde verwijderknop, zodat "wat wordt er deze week besteld" één
  // consistent geheel is i.p.v. twee losse stijlen. Shortfalls bestaan
  // alleen voor weekmenu-/voorraadregels; voor vaste boodschappen levert
  // shortfallByLineId vanzelf niets op, dus dat blok blijft dan gewoon weg.
  function renderShoppingLineRow(line: (typeof sortedLines)[number]) {
    const shortfall = shortfallByLineId.get(line.id);
    const statusMessage =
      line.id === focusedShortfallLineId && params.status ? STATUS_MESSAGES[params.status] : undefined;
    return (
      <div
        key={line.id}
        id={`meal-line-${line.id}`}
        className={`scroll-mt-6 p-4 transition-colors ${
          line.id === focusedShortfallLineId ? "bg-accent-soft" : ""
        }`}
      >
        <div className="flex min-w-0 items-center justify-between gap-4">
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
              {line.transferredToPicnicAt && (
                <p className="mt-0.5 text-xs font-medium text-tag-green-ink">Staat al in je Picnic-mandje</p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-sm text-ink-muted">{formatOrderQuantity(line)}</span>
            <form action={removeBoodschappenLineThisWeek}>
              <input type="hidden" name="lineId" value={line.id} />
              <PendingSubmitButton
                pendingText="..."
                ariaLabel="Verwijderen"
                title="Verwijderen"
                className={`flex h-7 w-7 items-center justify-center rounded-md text-ink-faint hover:bg-red-50 hover:text-red-600 ${ACTION_BUTTON_FOCUS}`}
              >
                <X size={14} />
              </PendingSubmitButton>
            </form>
          </div>
        </div>
        {statusMessage && (
          <p className="mt-2 rounded-md border border-tag-green-ink/20 bg-tag-green-bg px-2.5 py-1.5 text-xs font-medium text-tag-green-ink">
            {statusMessage}
          </p>
        )}
        {shortfall && (
          <div className="mt-3 rounded-lg border border-tag-amber-ink/25 bg-tag-amber-bg p-3">
            <p className="text-xs font-medium text-tag-amber-ink">
              Dit is {formatQuantity(shortfall.shortBy, shortfall.unit)} minder dan nodig voor de geplande
              maaltijden deze week.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <form action={fillShoppingListShortfall}>
                <input type="hidden" name="lineId" value={line.id} />
                <PendingSubmitButton
                  pendingText="Aanvullen..."
                  className={`rounded-md bg-tag-amber-ink px-3 py-1.5 text-xs font-semibold text-white ${ACTION_BUTTON_FOCUS}`}
                >
                  Aanvullen
                </PendingSubmitButton>
              </form>
              <form action={acknowledgeShoppingListShortfall}>
                <input type="hidden" name="lineId" value={line.id} />
                <PendingSubmitButton
                  pendingText="..."
                  className={`rounded-md border border-tag-amber-ink/40 bg-transparent px-3 py-1.5 text-xs font-medium text-tag-amber-ink ${ACTION_BUTTON_FOCUS}`}
                >
                  Toch doorgaan
                </PendingSubmitButton>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full min-w-0 max-w-2xl flex-col pb-[calc(6rem+env(safe-area-inset-bottom))]">
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

        {generalStatusMessage && WARNING_STATUSES.has(params.status ?? "") && (
          <p className="mb-6 rounded-lg border border-tag-amber-ink/20 bg-tag-amber-bg px-3 py-2 text-sm font-medium text-tag-amber-ink">
            {generalStatusMessage}
          </p>
        )}
        {generalStatusMessage && !WARNING_STATUSES.has(params.status ?? "") && (
          <p className="mb-6 rounded-lg border border-tag-green-ink/20 bg-tag-green-bg px-3 py-2 text-sm font-medium text-tag-green-ink">
            {generalStatusMessage}
          </p>
        )}

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
        <div id="jullie-boodschappenlijst" className="mb-3 scroll-mt-6 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">Jullie boodschappenlijst</h2>
          <span className="text-xs font-medium text-ink-muted">
            {mealTotalCost > 0 ? `€ ${mealTotalCost.toFixed(2)}` : "Prijs onbekend"}
          </span>
        </div>
        <div className="flex min-w-0 flex-col divide-y divide-line rounded-xl border border-line bg-surface">
          {mealLines.map(renderShoppingLineRow)}
        </div>

        {activeFixedLines.length > 0 && (
          <details id="alle-te-bestellen-producten" className="mt-3 scroll-mt-6">
            <summary className="cursor-pointer text-xs font-medium text-ink-muted hover:text-ink">
              + {activeFixedLines.length} vaste boodschap{activeFixedLines.length === 1 ? "" : "pen"} worden ook
              besteld — toon volledige lijst
            </summary>
            <div className="mt-3 flex min-w-0 flex-col divide-y divide-line rounded-xl border border-line bg-surface">
              {activeFixedLines.map(renderShoppingLineRow)}
            </div>
          </details>
        )}

        <PicnicDeliveryStatusCard householdId={household.id} picnicAuthToken={household.picnicAuthToken} />

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
          hasTransferredLines={hasTransferredLines}
          orderConfirmed={shoppingList.orderConfirmedAt !== null}
          fixedCount={fixedPendingCount}
          manualCount={manualPendingCount}
        />

        <LooseListCard
          householdId={household.id}
          weekStart={weekStart.toISOString()}
          hasTransferredLines={hasTransferredLines}
        />

        <div id="quick-add-product" className="mb-6 scroll-mt-6 rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">Product toevoegen</h2>
          <p className="mb-3 text-xs text-ink-muted">Voor deze week alleen — dit wordt geen vaste gewoonte.</p>
          {quickOrderRawFocus && (
            <p className="mb-3 rounded-md bg-accent-soft px-2.5 py-2 text-xs text-ink-muted">
              Je zoekt zelf een product voor &ldquo;{quickOrderRawFocus}&rdquo; uit je snelle lijstje — na het
              toevoegen kom je daar automatisch weer terug.
            </p>
          )}
          <form action="/boodschappen#quick-add-product" className="flex min-w-0 gap-2">
            {quickOrderRawFocus && (
              <>
                <input type="hidden" name="quickOrder" value={quickOrderText} />
                <input type="hidden" name="quickOrderRaw" value={quickOrderRawFocus} />
              </>
            )}
            <input
              name="manualQ"
              defaultValue={manualSearchQuery}
              placeholder="Zoek een product, bv. chips"
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

          {!household.picnicAuthToken && (
            <p className="mt-3 text-sm text-ink-muted">Koppel eerst Picnic om live producten te zoeken.</p>
          )}

          {manualSearchQuery && household.picnicAuthToken && manualProductResults.length === 0 && (
            <p className="mt-3 text-sm text-ink-muted">
              Geen Picnic-producten gevonden voor {manualSearchQuery}. Probeer een andere zoekterm.
            </p>
          )}

          {manualProductResults.length > 0 && (
            <div className="mt-4 grid gap-2">
              {manualProductResults.map((item) => (
                <form key={item.externalRef} action={addManualProduct} className="rounded-lg border border-line p-3">
                  <input type="hidden" name="shoppingListId" value={shoppingList.id} />
                  <input type="hidden" name="searchTerm" value={manualSearchQuery} />
                  {quickOrderRawFocus && (
                    <>
                      <input type="hidden" name="raw" value={quickOrderRawFocus} />
                      <input type="hidden" name="quickOrderText" value={quickOrderText} />
                    </>
                  )}
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
                          Toevoegen
                        </button>
                      </div>
                    </div>
                  </div>
                </form>
              ))}
            </div>
          )}
        </div>

        <div id="quick-order" className="mb-6 scroll-mt-6 rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">Snel meerdere producten toevoegen</h2>
          <p className="mb-3 text-xs text-ink-muted">Voor deze week alleen.</p>
          <form action="/boodschappen#quick-order" className="grid gap-2">
            <textarea
              name="quickOrder"
              defaultValue={quickOrderText}
              rows={3}
              placeholder={"Rijst, Sperziebonen, Appelmoes"}
              className="min-h-20 min-w-0 resize-y rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <button
              type="submit"
              className="w-fit rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent/90"
            >
              Zoeken
            </button>
          </form>

          {quickOrderText && !household.picnicAuthToken && quickOrderPickLines.length > 0 && (
            <p className="mt-3 text-sm text-ink-muted">Koppel eerst Picnic om onbekende producten op te zoeken.</p>
          )}

          {quickOrderAutoLines.length > 0 && (
            <form
              action={addQuickOrderTrustedProducts}
              className="mt-4 rounded-lg border border-accent/30 bg-accent-soft p-3"
            >
              <input type="hidden" name="householdId" value={household.id} />
              <input type="hidden" name="quickOrderText" value={quickOrderText} />
              {quickOrderAutoLines.map((line, index) => (
                <input
                  key={`${line.raw}-${index}`}
                  type="hidden"
                  name="choice"
                  value={JSON.stringify({
                    householdId: household.id,
                    shoppingListId: shoppingList.id,
                    raw: line.raw,
                    searchTerm: line.trustedChoice!.searchTerm,
                    productName: line.trustedChoice!.productName,
                    externalRef: line.trustedChoice!.externalRef,
                    packageSize: line.trustedChoice!.packageSize,
                    picnicImageId: line.trustedChoice!.picnicImageId,
                    quantity: line.quantity,
                    unit: line.unit,
                    price: line.trustedChoice!.price,
                  })}
                />
              ))}
              <p className="mb-2 text-sm font-medium text-ink">
                {quickOrderAutoLines.length} herkend als jullie eerdere keuze:
              </p>
              <ul className="mb-3 grid gap-1 text-xs text-ink-muted">
                {quickOrderAutoLines.map((line, index) => (
                  <li key={`${line.raw}-${index}`}>
                    {line.raw} → {line.trustedChoice!.productName}
                  </li>
                ))}
              </ul>
              <button
                type="submit"
                className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent/90"
              >
                Automatisch toevoegen
              </button>
            </form>
          )}

          {quickOrderPickLines.length > 0 && (
            <form action={addQuickOrderPickedProducts} className="mt-4 grid gap-4">
              <input type="hidden" name="householdId" value={household.id} />
              <input type="hidden" name="quickOrderText" value={quickOrderText} />
              {quickOrderPickLines.map((line, lineIndex) => (
                <div key={`${line.raw}-${lineIndex}`} className="rounded-lg border border-line bg-surface-2 p-3">
                  <p className="mb-2 text-sm font-semibold text-ink">{line.raw}</p>
                  {line.results.length === 0 ? (
                    <p className="mb-2 text-sm text-ink-muted">
                      Geen Picnic-product gevonden. Probeer een andere zoekterm.
                    </p>
                  ) : (
                    <div className="grid gap-2">
                      {line.results.map((item, itemIndex) => (
                        <label
                          key={item.externalRef}
                          className="flex min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-line bg-surface p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
                        >
                          <input
                            type="radio"
                            name={`choice-${lineIndex}`}
                            defaultChecked={itemIndex === 0}
                            value={JSON.stringify({
                              householdId: household.id,
                              shoppingListId: shoppingList.id,
                              raw: line.raw,
                              searchTerm: line.searchTerm,
                              productName: item.name ?? "",
                              externalRef: item.externalRef,
                              packageSize: item.unit_quantity ?? "",
                              picnicImageId: item.image_id ?? "",
                              quantity: line.quantity,
                              unit: line.unit,
                              price: picnicPriceToEuros(item.display_price ?? item.price),
                            })}
                            className="h-4 w-4 shrink-0 accent-accent"
                          />
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
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                  <Link
                    href={`/boodschappen?${new URLSearchParams({
                      manualQ: line.searchTerm,
                      quickOrder: quickOrderText,
                      quickOrderRaw: line.raw,
                    }).toString()}#quick-add-product`}
                    className="mt-2 inline-block text-xs font-medium text-ink-faint underline decoration-dotted hover:text-accent"
                  >
                    Niet het goede product? Zelf zoeken
                  </Link>
                </div>
              ))}
              {quickOrderPickLines.some((line) => line.results.length > 0) && (
                <PendingSubmitButton
                  pendingText="Bezig..."
                  className="w-fit rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent/90"
                >
                  Voeg toe
                </PendingSubmitButton>
              )}
            </form>
          )}
        </div>

        <details id="daily-review" className="mb-8 mt-4 min-w-0 scroll-mt-6" open={focusedLineId ? true : undefined}>
          <summary className="cursor-pointer text-sm font-semibold text-ink">Bekijk per dag</summary>
          <div className="mt-3 grid gap-4">
            {mealPlan.entries.map((entry) => {
              const dayKey = DAY_KEY_BY_ENUM[entry.dayOfWeek];
              const scale = portionScaleByDay[dayKey]?.scale ?? 1;
              const dayReviewCount = dayReviewCounts.get(entry.id) ?? 0;
              const dayCost = entry.recipeVariant.recipe.ingredients.reduce((total, ri) => {
                const line = mealLineByIngredientId.get(ri.ingredientId);
                const scaledNeed = { quantity: ri.quantity * scale, unit: ri.unit };
                return total + estimatedDayIngredientCost(scaledNeed, line?.product);
              }, 0);
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
                      <p className="mt-1 text-xs font-medium text-ink-muted">
                        Daginschatting: {dayCost > 0 ? `€ ${dayCost.toFixed(2)}` : "prijs onbekend"}
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
                      const candidates = line ? candidatesByIngredient.get(line.ingredientId) ?? [] : [];
                      const alternatives = candidates.filter((candidate) => candidate.id !== line?.product?.id).slice(0, 5);
                      const statusMessage =
                        line?.id === focusedLineId && params.status ? STATUS_MESSAGES[params.status] : undefined;
                      return (
                        <div
                          key={ri.id}
                          id={line ? `day-line-${line.id}` : undefined}
                          className={`scroll-mt-6 rounded-lg border bg-surface-2 p-3 transition-colors ${
                            line?.id === focusedLineId ? "border-accent ring-2 ring-accent/20" : "border-line"
                          }`}
                        >
                          {statusMessage && (
                            <p className="mb-2 rounded-md border border-tag-green-ink/20 bg-tag-green-bg px-2.5 py-1.5 text-xs font-medium text-tag-green-ink">
                              {statusMessage}
                            </p>
                          )}
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
                                {line?.product?.price && (
                                  <p className="mt-0.5 text-[11px] font-medium text-ink-muted">
                                    Maaltijdkosten: € {estimatedDayIngredientCost(scaledNeed, line.product).toFixed(2)}
                                  </p>
                                )}
                                {line?.needsReview && (
                                  <p className="mt-1 text-xs font-medium text-tag-amber-ink">Nog te bevestigen</p>
                                )}
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="font-semibold text-ink">
                                {formatNeededOrderQuantity(scaledNeed, line?.product)}
                              </p>
                              {line && (
                                <p className="text-[11px] text-ink-faint">voor deze maaltijd</p>
                              )}
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
                          {line && (
                            <div className="mt-3 grid gap-2">
                              <details className="rounded-lg border border-line bg-surface p-2">
                                <summary className="cursor-pointer text-xs font-medium text-ink">
                                  Weektotaal aanpassen: {formatOrderQuantity(line)}
                                </summary>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <form action={adjustBoodschappenLineQuantity}>
                                    <input type="hidden" name="lineId" value={line.id} />
                                    <input type="hidden" name="direction" value="decrease" />
                                    <PendingSubmitButton
                                      pendingText="..."
                                      ariaLabel="Minder voor de week bestellen"
                                      title="Minder voor de week bestellen"
                                      className={`flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface text-ink hover:border-accent/70 hover:bg-white ${ACTION_BUTTON_FOCUS}`}
                                    >
                                      <Minus size={14} />
                                    </PendingSubmitButton>
                                  </form>
                                  <form action={adjustBoodschappenLineQuantity}>
                                    <input type="hidden" name="lineId" value={line.id} />
                                    <input type="hidden" name="direction" value="increase" />
                                    <PendingSubmitButton
                                      pendingText="..."
                                      ariaLabel="Meer voor de week bestellen"
                                      title="Meer voor de week bestellen"
                                      className={`flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface text-ink hover:border-accent/70 hover:bg-white ${ACTION_BUTTON_FOCUS}`}
                                    >
                                      <Plus size={14} />
                                    </PendingSubmitButton>
                                  </form>
                                  <form action={removeBoodschappenLineThisWeek}>
                                    <input type="hidden" name="lineId" value={line.id} />
                                    <PendingSubmitButton
                                      pendingText="..."
                                      ariaLabel="Uit de hele weeklijst verwijderen"
                                      title="Uit de hele weeklijst verwijderen"
                                      className={`flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface text-ink-faint hover:border-red-300 hover:bg-red-50 hover:text-red-600 ${ACTION_BUTTON_FOCUS}`}
                                    >
                                      <X size={14} />
                                    </PendingSubmitButton>
                                  </form>
                                  <form action={setBoodschappenLinePackageCount} className="flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1">
                                    <input type="hidden" name="lineId" value={line.id} />
                                    <input
                                      type="number"
                                      name="packageCount"
                                      defaultValue={orderPackageCount(line)}
                                      min="0.01"
                                      step="any"
                                      aria-label="Aantal verpakkingen voor de week"
                                      className="w-14 bg-transparent text-sm font-medium text-ink outline-none"
                                    />
                                    <span className="text-[11px] text-ink-faint">x per week</span>
                                    <PendingSubmitButton
                                      pendingText="..."
                                      className={`rounded px-1.5 py-0.5 text-[11px] font-medium text-accent hover:bg-accent-soft ${ACTION_BUTTON_FOCUS}`}
                                    >
                                      OK
                                    </PendingSubmitButton>
                                  </form>
                                </div>
                              </details>
                              {line.product && line.needsReview && (
                                <DayProductChoice line={line} product={line.product} selected />
                              )}
                            </div>
                          )}
                          {line && alternatives.length > 0 && (
                            <details className="mt-3 rounded-lg border border-line bg-surface p-2">
                              <summary className="cursor-pointer text-xs font-medium text-ink">
                                {alternatives.length} {alternatives.length === 1 ? "alternatief" : "alternatieven"}
                              </summary>
                              <div className="mt-2 grid gap-2">
                                {alternatives.map((candidate) => (
                                  <DayProductChoice key={candidate.id} line={line} product={candidate} />
                                ))}
                              </div>
                            </details>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        </details>

        <details
          id="fixed-groceries"
          className="mt-8 scroll-mt-6 rounded-xl border border-line bg-surface p-4"
          open={focusedFixedLineId || fixedReplaceLineId ? true : undefined}
        >
          <summary className="cursor-pointer text-sm font-semibold text-ink">
            {activeFixedLines.length + inactiveFixedItems.length} vaste boodschap
            {activeFixedLines.length + inactiveFixedItems.length === 1 ? "" : "pen"}
          </summary>
          {focusedFixedLineId && params.status && STATUS_MESSAGES[params.status] && (
            <p className="mt-3 rounded-md border border-tag-green-ink/20 bg-tag-green-bg px-2.5 py-1.5 text-xs font-medium text-tag-green-ink">
              {STATUS_MESSAGES[params.status]}
            </p>
          )}
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
              <div className="flex min-w-0 items-center gap-3">
                <ProductThumb line={line} />
                <div className="min-w-0 flex-1">
                  <p className="min-w-0 truncate text-ink">{line.product?.name ?? line.ingredient.name}</p>
                  {line.product?.packageSize && (
                    <p className="mt-0.5 text-xs text-ink-faint">{line.product.packageSize}</p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
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
                <form action={removeFixedGroceryPermanently}>
                  <input type="hidden" name="householdId" value={household.id} />
                  <input type="hidden" name="ingredientId" value={line.ingredientId} />
                  <input type="hidden" name="lineId" value={line.id} />
                  <button
                    type="submit"
                    className="shrink-0 text-xs font-medium text-ink-faint transition-colors hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.98]"
                  >
                    Verwijder voorgoed
                  </button>
                </form>
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
            <div key={item.id} className="flex min-w-0 flex-col gap-2 p-4">
              <div className="flex min-w-0 items-center gap-3 opacity-60">
                <ProductImage product={inactiveFixedProductByIngredientId.get(item.ingredientId)} label={item.ingredient.name} />
                <p className="min-w-0 flex-1 truncate text-ink-faint line-through">{item.ingredient.name}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
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
                  <p className="mt-1 text-xs text-ink-muted">Ik zoek elke regel op bij Picnic.</p>
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
                              <input type="hidden" name="bulkFixedRaw" value={line.raw} />
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

        <details
          id="inventory-check"
          className="mt-6 scroll-mt-6 rounded-xl border border-line bg-surface p-4"
          open={focusedInventoryId || inventoryAttentionItems.length > 0 ? true : undefined}
        >
          <summary className="cursor-pointer text-sm font-semibold text-ink">
            {inventoryAttentionItems.length > 0
              ? `Voorraadcheck: ${inventoryAttentionItems.length} basisproducten`
              : "Voorraad ziet er goed uit"}
          </summary>
          {focusedInventoryId && params.status && STATUS_MESSAGES[params.status] && (
            <p className="mt-3 rounded-md border border-tag-green-ink/20 bg-tag-green-bg px-2.5 py-1.5 text-xs font-medium text-tag-green-ink">
              {STATUS_MESSAGES[params.status]}
            </p>
          )}
          {inventoryAttentionItems.length > 0 ? (
            <>
              <p className="mt-2 text-sm text-ink-muted">
                Hoe staat het met deze basisproducten? Ik onthoud je antwoord voor volgende keren.
              </p>
              <div className="mt-3 flex min-w-0 flex-col divide-y divide-line">
                {inventoryAttentionItems.map((item) => (
                  <InventoryRow
                    key={item.ingredientId}
                    item={item}
                    householdId={household.id}
                    focused={item.ingredientId === focusedInventoryId}
                  />
                ))}
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">
              Geen van jullie basisproducten heeft deze week een check nodig.
            </p>
          )}
          {inventoryConfirmedItems.length > 0 && (
            <details className="mt-4" open={focusedInventoryIsConfirmed ? true : undefined}>
              <summary className="cursor-pointer text-xs font-medium text-ink-muted">
                {inventoryConfirmedItems.length} recent bevestigd
              </summary>
              <div className="mt-2 flex min-w-0 flex-col divide-y divide-line">
                {inventoryConfirmedItems.map((item) => (
                  <InventoryRow
                    key={item.ingredientId}
                    item={item}
                    householdId={household.id}
                    focused={item.ingredientId === focusedInventoryId}
                  />
                ))}
              </div>
            </details>
          )}
        </details>

        <details className="mb-6 min-w-0 rounded-xl border border-line bg-surface p-4">
          <summary className="cursor-pointer text-sm font-semibold text-ink">
            Zelf boodschappen doen {checklistLines.length > 0 && `(${checklistPickedUpCount}/${checklistLines.length})`}
          </summary>
          <div className="mt-3">
            <ShoppingChecklist lines={checklistLines} />
          </div>
        </details>

      </div>

      <NavBar />
    </div>
  );
}
