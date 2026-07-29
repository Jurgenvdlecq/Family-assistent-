import { redirect } from "next/navigation";
import Link from "next/link";
import { after } from "next/server";
import {
  ChevronLeft,
  ClipboardCheck,
  CheckCircle2,
  AlertCircle,
  Search,
  ShoppingBasket,
} from "lucide-react";
import { requireCurrentHousehold } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMealPlanForWeek } from "@/lib/mealPlan";
import { getCurrentWeekStart } from "@/lib/week";
import { ensureShoppingList, getShoppingListCandidatesByIngredient, describeLinePackaging } from "@/lib/shoppingList";
import { enrichShoppingListProductImages } from "@/lib/picnic/productEnrichment";
import NavBar from "@/components/NavBar";
import Tag from "@/components/Tag";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import {
  confirmProductChoice,
  rejectProductChoice,
  useProductThisWeekOnly,
  adjustLineQuantity,
  removeLineFromList,
  skipReview,
  confirmShoppingList,
  searchPicnicProductsForLine,
} from "./actions";
import { picnicImageUrl } from "@/lib/picnic/products";
import { PicnicClient } from "@/lib/picnic/client";
import { picnicPriceToEuros, picnicProductRef } from "@/lib/picnic/products";
import { parsePackageQuantity } from "@/lib/quantity/parsePackageSize";
import { logEvent, errorMessage } from "@/lib/logger";

// ensureShoppingList schrijft (idempotent) naar de database — nooit
// statisch prerenderen tijdens de build.
export const dynamic = "force-dynamic";

const UNIT_LABELS: Record<string, string> = { GRAM: "gram", ML: "ml", PIECE: "stuks" };
const ACTION_BUTTON_FOCUS =
  "shadow-sm transition-all duration-150 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:translate-y-0 active:scale-[0.98]";

function formatPrice(price: unknown) {
  if (price === null || price === undefined) return null;
  return `€ ${Number(price).toFixed(2)}`;
}

function formatQuantity(quantity: number, unit: string) {
  if (unit === "GRAM") return `${quantity} g`;
  if (unit === "ML") return `${quantity} ml`;
  return `${quantity}x`;
}

function formatLineNeed(quantity: number, unit: string) {
  if (unit === "GRAM" && quantity >= 1000) return `${quantity / 1000} kg nodig`;
  if (unit === "ML" && quantity >= 1000) return `${quantity / 1000} liter nodig`;
  return `${formatQuantity(quantity, unit)} nodig`;
}

/** "2 verpakkingen · 1000 g totaal · 200 g over" — of niets als de verpakking onbekend is (Fase 3). */
function PackagingLine({
  line,
  product,
}: {
  line: { quantity: number; unit: string; source: string };
  product: { packageQuantity: number | null } | null | undefined;
}) {
  // Een vaste boodschap in stuks geeft al direct het aantal te bestellen
  // producten aan ("1x nodig" = 1 verpakking) — Product.packageQuantity is
  // hier altijd berekend in de eenheid van het ingrediënt (vaak gram/ml),
  // niet per se in stuks. Verpakkingsrekenwerk hierop loslaten geeft dan
  // onzinnige uitkomsten (bv. "130x totaal · 129x over" voor 1 pak
  // rijstwafels van 130 gram). Zelfde regel als `formatOrderQuantity` op
  // /boodschappen.
  if (line.source === "FIXED" && line.unit === "PIECE") return null;

  const breakdown = describeLinePackaging(
    { quantity: line.quantity, unit: line.unit as "GRAM" | "ML" | "PIECE" },
    product
  );
  if (breakdown.status !== "OK") {
    return <p className="text-xs font-medium text-tag-amber-ink">Verpakkingsgrootte onbekend, controleer handmatig.</p>;
  }
  return (
    <p className="text-xs text-ink-faint">
      {breakdown.packagesToBuy} {breakdown.packagesToBuy === 1 ? "verpakking" : "verpakkingen"} ·{" "}
      {formatQuantity(breakdown.totalPurchased!.amount, breakdown.totalPurchased!.unit)} totaal
      {breakdown.expectedSurplus!.amount > 0 && (
        <> · {formatQuantity(breakdown.expectedSurplus!.amount, breakdown.expectedSurplus!.unit)} over</>
      )}
    </p>
  );
}

type ProductCardProduct = {
  id: string;
  name: string;
  brand: string | null;
  packageSize: string | null;
  packageQuantity: number | null;
  price: unknown;
  picnicImageId: string | null;
  externalRef: string | null;
};

function ProductImage({ product }: { product: ProductCardProduct | null | undefined }) {
  const url = picnicImageUrl(product?.picnicImageId, "medium");
  return (
    <div
      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-line bg-white bg-contain bg-center bg-no-repeat text-ink-faint"
      style={url ? { backgroundImage: `url(${url})` } : undefined}
      aria-label={product?.name ?? "Geen productafbeelding"}
    >
      {!url && <ShoppingBasket size={20} />}
    </div>
  );
}

function ProductChoiceCard({
  line,
  product,
  householdId,
  selected = false,
}: {
  line: { id: string; ingredientId: string; quantity: number; unit: string; needsReview: boolean; source: string };
  product: ProductCardProduct;
  householdId: string;
  selected?: boolean;
}) {
  return (
    <div
      className={`min-w-0 rounded-lg border bg-surface p-3 ${
        selected ? "border-accent/50" : "border-line"
      }`}
    >
      <div className="flex min-w-0 gap-3">
        <ProductImage product={product} />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="line-clamp-2 text-sm font-medium text-ink">{product.name}</p>
              <p className="text-xs text-ink-faint">
                {[product.brand, product.packageSize].filter(Boolean).join(" · ") || "Geen verpakkingsinfo"}
              </p>
              {!product.externalRef && (
                <p className="mt-1 text-xs font-medium text-tag-amber-ink">
                  Nog geen bevestigd Picnic-product
                </p>
              )}
            </div>
            <span className="shrink-0 text-sm font-semibold text-ink">
              {formatPrice(product.price) ?? "Prijs onbekend"}
            </span>
          </div>

          <PackagingLine line={line} product={product} />

          <div className="mt-3 flex flex-wrap gap-2">
            {selected && !line.needsReview ? (
              <span className="rounded-md bg-tag-green-bg px-2.5 py-1.5 text-xs font-medium text-tag-green-ink">
                Opgeslagen
              </span>
            ) : (
              <form action={confirmProductChoice}>
                <input type="hidden" name="lineId" value={line.id} />
                <input type="hidden" name="productId" value={product.id} />
                <input type="hidden" name="householdId" value={householdId} />
                <PendingSubmitButton
                  pendingText="Opslaan..."
                  className={`rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink hover:bg-accent/90 ${ACTION_BUTTON_FOCUS}`}
                >
                  {selected ? "Goed, onthouden" : "Kies en onthoud"}
                </PendingSubmitButton>
              </form>
            )}
            <form action={useProductThisWeekOnly}>
              <input type="hidden" name="lineId" value={line.id} />
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="householdId" value={householdId} />
              <PendingSubmitButton
                pendingText="Kiezen..."
                className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:border-accent/70 hover:bg-surface-2 ${ACTION_BUTTON_FOCUS}`}
              >
                Alleen deze week
              </PendingSubmitButton>
            </form>
            <form action={rejectProductChoice}>
              <input type="hidden" name="lineId" value={line.id} />
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="householdId" value={householdId} />
              <PendingSubmitButton
                pendingText="Wegzetten..."
                className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-faint hover:border-red-300 hover:bg-red-50 hover:text-red-600 ${ACTION_BUTTON_FOCUS}`}
              >
                Nooit
              </PendingSubmitButton>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

const STATUS_MESSAGES: Record<string, string> = {
  remembered: "Opgeslagen en onthouden voor volgende keer.",
  "week-only": "Gekozen voor deze week.",
  rejected: "Afgewezen. Ik stel dit product niet meer automatisch voor.",
  quantity: "Hoeveelheid bijgewerkt.",
  searched: "Alternatieven opgehaald. Kies hieronder het juiste product.",
  skipped: "Opgeslagen zonder bevestigd product.",
};

async function ensureMinimumCandidatesForLines({
  householdId,
  picnicAuthToken,
  lines,
  candidatesByIngredient,
}: {
  householdId: string;
  picnicAuthToken: string | null;
  lines: {
    ingredientId: string;
    ingredient: { name: string; unit: string };
  }[];
  candidatesByIngredient: Map<string, ProductCardProduct[]>;
}) {
  if (!picnicAuthToken) return candidatesByIngredient;

  const missingLines = lines.filter((line) => (candidatesByIngredient.get(line.ingredientId) ?? []).length < 4);
  if (missingLines.length === 0) return candidatesByIngredient;

  const client = new PicnicClient(picnicAuthToken);
  const refreshedIngredientIds = new Set<string>();
  try {
    for (const line of missingLines.slice(0, 5)) {
      if (refreshedIngredientIds.has(line.ingredientId)) continue;
      refreshedIngredientIds.add(line.ingredientId);
      const results = await client.search(line.ingredient.name);
      const seenRefs = new Set(candidatesByIngredient.get(line.ingredientId)?.map((product) => product.externalRef).filter(Boolean));
      const productsToSave = results.slice(0, 12).flatMap((item) => {
        const externalRef = picnicProductRef(item);
        if (!externalRef || !item.name || seenRefs.has(externalRef)) return [];
        seenRefs.add(externalRef);
        const packageSize = item.unit_quantity ?? null;
        return [
          {
            ingredientId: line.ingredientId,
            externalRef,
            picnicImageId: item.image_id ?? null,
            name: item.name,
            packageSize,
            packageQuantity: parsePackageQuantity(packageSize, line.ingredient.unit as "GRAM" | "ML" | "PIECE"),
            price: picnicPriceToEuros(item.display_price ?? item.price),
            lastSeenAvailable: new Date(),
          },
        ];
      });
      await Promise.all(
        productsToSave.map((data) =>
          prisma.product.upsert({
            where: {
              ingredientId_provider_externalRef: {
                ingredientId: data.ingredientId,
                provider: "PICNIC",
                externalRef: data.externalRef,
              },
            },
            update: data,
            create: data,
          })
        )
      );
    }

    const refreshedToken = client.getAuthToken();
    if (refreshedToken && refreshedToken !== picnicAuthToken) {
      await prisma.household.update({
        where: { id: householdId },
        data: { picnicAuthToken: refreshedToken, picnicTokenUpdatedAt: new Date() },
      });
    }

    return getShoppingListCandidatesByIngredient(
      householdId,
      lines.map((line) => line.ingredientId)
    );
  } catch (error) {
    logEvent({
      level: "warn",
      area: "product_matching",
      message: "Picnic-alternatieven automatisch aanvullen mislukt",
      meta: { householdId, error: errorMessage(error) },
    });
    return candidatesByIngredient;
  }
}

function LineControlCard({
  line,
  candidates,
  householdId,
  statusMessage,
}: {
  line: {
    id: string;
    ingredientId: string;
    quantity: number;
    unit: string;
    needsReview: boolean;
    matchReasons: string[];
    product: ProductCardProduct | null;
    ingredient: { name: string };
    source: string;
  };
  candidates: ProductCardProduct[];
  householdId: string;
  statusMessage?: string;
}) {
  const alternatives = candidates.filter((candidate) => candidate.id !== line.product?.id);

  return (
    <div
      id={`line-${line.id}`}
      className={`min-w-0 scroll-mt-6 rounded-xl border p-4 transition-colors target:border-accent target:ring-2 target:ring-accent/20 ${
        line.needsReview ? "border-tag-amber-ink/25 bg-tag-amber-bg" : "border-line bg-surface"
      }`}
    >
      <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink">{line.ingredient.name}</p>
          <p className="text-xs text-ink-faint">{formatLineNeed(line.quantity, line.unit)}</p>
        </div>
        {line.needsReview && <Tag tone="amber">Controleren</Tag>}
      </div>

      {line.matchReasons.length > 0 && (
        <p className="mb-3 rounded-lg bg-white/60 px-3 py-2 text-xs text-ink-muted">
          {line.matchReasons.join(" ")}
        </p>
      )}

      {statusMessage && (
        <p className="mb-3 rounded-lg border border-tag-green-ink/20 bg-tag-green-bg px-3 py-2 text-xs font-medium text-tag-green-ink">
          {statusMessage}
        </p>
      )}

      <form action={adjustLineQuantity} className="mb-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="lineId" value={line.id} />
        <input
          type="number"
          name="quantity"
          defaultValue={line.quantity}
          step="any"
          min="0.01"
          className="w-24 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
        />
        <span className="text-xs text-ink-faint">{UNIT_LABELS[line.unit] ?? line.unit}</span>
        <PendingSubmitButton
          pendingText="Bijwerken..."
          className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:border-accent/70 hover:bg-surface-2 ${ACTION_BUTTON_FOCUS}`}
        >
          Hoeveelheid
        </PendingSubmitButton>
      </form>

      <form action={searchPicnicProductsForLine} className="mb-3 flex min-w-0 gap-2">
        <input type="hidden" name="lineId" value={line.id} />
        <input
          name="query"
          placeholder={`Zoek Picnic-product, bv. ${line.ingredient.name}`}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
        <PendingSubmitButton
          pendingText="..."
          ariaLabel="Zoeken bij Picnic"
          title="Zoeken bij Picnic"
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink hover:border-accent/70 hover:bg-surface-2 ${ACTION_BUTTON_FOCUS}`}
        >
          <Search size={16} />
        </PendingSubmitButton>
      </form>

      <div className="grid gap-2">
        {line.product ? (
          <ProductChoiceCard line={line} product={line.product} householdId={householdId} selected />
        ) : (
          <div className="rounded-lg border border-line bg-surface p-3">
            <p className="text-sm font-medium text-ink">Nog geen Picnic-product gekozen</p>
            <p className="mt-1 text-xs text-ink-faint">Zoek hierboven of verwijder deze regel als je hem niet nodig hebt.</p>
          </div>
        )}

        {alternatives.length > 0 && (
          <details className="rounded-lg border border-line bg-surface p-3" open={alternatives.length < 3 ? true : undefined}>
            <summary className="cursor-pointer text-sm font-medium text-ink">
              {alternatives.length} {alternatives.length === 1 ? "alternatief" : "alternatieven"}
            </summary>
            {alternatives.length < 3 && (
              <p className="mt-2 text-xs text-ink-faint">
                Ik heb minder dan 3 alternatieven gevonden. Zoek hierboven specifieker als je meer keuze wilt zien.
              </p>
            )}
            <div className="mt-3 grid gap-2">
              {alternatives.map((candidate) => (
                <ProductChoiceCard
                  key={candidate.id}
                  line={line}
                  product={candidate}
                  householdId={householdId}
                />
              ))}
            </div>
          </details>
        )}
      </div>

      {!line.product && (
        <div className="mt-3 flex flex-wrap gap-2">
          <form action={skipReview}>
            <input type="hidden" name="lineId" value={line.id} />
            <PendingSubmitButton
              pendingText="Opslaan..."
              className={`rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:border-accent/70 hover:bg-surface-2 ${ACTION_BUTTON_FOCUS}`}
            >
              Zonder product doorgaan
            </PendingSubmitButton>
          </form>
          <form action={removeLineFromList}>
            <input type="hidden" name="lineId" value={line.id} />
            <PendingSubmitButton
              pendingText="Verwijderen..."
              className={`rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink-faint hover:border-red-300 hover:bg-red-50 hover:text-red-600 ${ACTION_BUTTON_FOCUS}`}
            >
              Van lijst verwijderen
            </PendingSubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}

export default async function ControlePage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string; status?: string }>;
}) {
  const params = await searchParams;
  const household = await requireCurrentHousehold();

  const weekStart = getCurrentWeekStart();
  const mealPlan = await getMealPlanForWeek(household.id, weekStart);
  if (!mealPlan) redirect("/");

  const shoppingList = await ensureShoppingList(mealPlan.id, household.id);
  if (shoppingList.lines.some((line) => line.product && !line.product.picnicImageId)) {
    after(() => enrichShoppingListProductImages(household.id, shoppingList.id));
  }

  const trustedLines = shoppingList.lines.filter((l) => !l.needsReview);
  const reviewLines = shoppingList.lines.filter((l) => l.needsReview);
  const sortedReviewLines = [...reviewLines].sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name));
  const sortedTrustedLines = [...trustedLines].sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name));
  const focusedTrustedLine = sortedTrustedLines.some((line) => line.id === params.focus);

  const focusedTrustedLines = sortedTrustedLines.filter((line) => line.id === params.focus);
  const candidateLines = [...sortedReviewLines, ...focusedTrustedLines];
  const initialCandidatesByIngredient = await getShoppingListCandidatesByIngredient(
    household.id,
    candidateLines.map((line) => line.ingredientId)
  );
  const candidatesByIngredient = await ensureMinimumCandidatesForLines({
    householdId: household.id,
    picnicAuthToken: household.picnicAuthToken,
    lines: candidateLines,
    candidatesByIngredient: initialCandidatesByIngredient,
  });
  const candidatesByLine = new Map(
    candidateLines.map((line) => [line.id, candidatesByIngredient.get(line.ingredientId) ?? []])
  );

  // Fase 6: "niet gevonden" is een apart geval van "aandacht nodig" — geen
  // enkel bekend product om uit te kiezen, dus andere acties dan een
  // twijfelgeval met wél kandidaten.
  const notFoundLines = reviewLines.filter((l) => (candidatesByLine.get(l.id) ?? []).length === 0);
  const attentionLines = reviewLines.filter((l) => (candidatesByLine.get(l.id) ?? []).length > 0);

  return (
    <div className="mx-auto flex min-h-screen w-full min-w-0 max-w-2xl flex-col pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between px-6 pt-6 pb-2">
        <Link href="/" aria-label="Terug naar Jouw week" className="text-ink-muted">
          <ChevronLeft size={22} />
        </Link>
        <span className="text-sm font-semibold">Controle</span>
        <ClipboardCheck size={18} className="text-ink-muted" />
      </header>

      <div className="min-w-0 px-6 pt-4">
        <h1 className="mb-1 flex items-center gap-2 text-[1.6rem] font-semibold leading-tight text-ink">
          {reviewLines.length === 0 ? "Alles staat klaar" : "Alles staat bijna klaar"}
          <CheckCircle2 size={22} className="shrink-0 text-tag-green-ink" />
        </h1>
        <p className="mb-5 text-[15px] text-ink-muted">
          Ik laat vooral zien waar ik onzeker ben. Vertrouwde keuzes staan onderaan rustig bij elkaar.
        </p>

        <div className="mb-7 flex flex-wrap gap-2">
          <Tag tone="green">{trustedLines.length} vertrouwde keuzes</Tag>
          {attentionLines.length > 0 && <Tag tone="amber">{attentionLines.length} vragen aandacht</Tag>}
          {notFoundLines.length > 0 && <Tag tone="amber">{notFoundLines.length} niet gevonden</Tag>}
        </div>

        {reviewLines.length > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-tag-amber-ink/25 bg-tag-amber-bg p-3 text-sm text-ink-muted">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-tag-amber-ink" />
            <p>Controleer de gemarkeerde regels voordat je de lijst bevestigt.</p>
          </div>
        )}

        {reviewLines.length > 0 ? (
          <div className="mb-8 grid gap-4">
            {sortedReviewLines.map((line) => (
              <LineControlCard
                key={line.id}
                line={line}
                candidates={candidatesByLine.get(line.id) ?? []}
                householdId={household.id}
                statusMessage={line.id === params.focus && params.status ? STATUS_MESSAGES[params.status] : undefined}
              />
            ))}
          </div>
        ) : (
          <div className="mb-6 rounded-xl border border-tag-green-ink/25 bg-tag-green-bg p-4">
            <p className="font-medium text-tag-green-ink">Geen uitzonderingen gevonden</p>
            <p className="mt-1 text-sm text-ink-muted">
              Producten, verpakkingen en hoeveelheden zijn bekend genoeg om te bevestigen.
            </p>
          </div>
        )}

        {trustedLines.length > 0 && (
          <details className="mb-8 rounded-xl border border-line bg-surface p-4" open={focusedTrustedLine || undefined}>
            <summary className="cursor-pointer text-sm font-medium text-ink">
              {trustedLines.length} vertrouwde keuze{trustedLines.length === 1 ? "" : "s"} bekijken
            </summary>
            <div className="mt-3 grid gap-3">
              {sortedTrustedLines.map((line) => (
                <LineControlCard
                  key={line.id}
                  line={line}
                  candidates={candidatesByLine.get(line.id) ?? []}
                  householdId={household.id}
                  statusMessage={line.id === params.focus && params.status ? STATUS_MESSAGES[params.status] : undefined}
                />
              ))}
            </div>
          </details>
        )}

        <form action={confirmShoppingList}>
          <input type="hidden" name="shoppingListId" value={shoppingList.id} />
          <PendingSubmitButton
            pendingText="Bevestigen..."
            disabled={reviewLines.length > 0}
            className={`w-full rounded-xl bg-accent px-4 py-3.5 text-center font-medium text-accent-ink hover:bg-accent/90 ${ACTION_BUTTON_FOCUS}`}
          >
            {reviewLines.length > 0 ? "Los eerst de twijfelgevallen op" : "Bevestigen"}
          </PendingSubmitButton>
        </form>
      </div>

      <NavBar />
    </div>
  );
}
