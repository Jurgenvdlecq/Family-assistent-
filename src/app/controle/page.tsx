import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  ClipboardCheck,
  CheckCircle2,
  AlertCircle,
  Search,
  ShoppingBasket,
} from "lucide-react";
import { requireCurrentHousehold } from "@/lib/auth";
import { getMealPlanForWeek } from "@/lib/mealPlan";
import { getCurrentWeekStart } from "@/lib/week";
import { ensureShoppingList, getShoppingListCandidates, describeLinePackaging } from "@/lib/shoppingList";
import NavBar from "@/components/NavBar";
import Tag from "@/components/Tag";
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

// ensureShoppingList schrijft (idempotent) naar de database — nooit
// statisch prerenderen tijdens de build.
export const dynamic = "force-dynamic";

const UNIT_LABELS: Record<string, string> = { GRAM: "gram", ML: "ml", PIECE: "stuks" };

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
  line: { quantity: number; unit: string };
  product: { packageQuantity: number | null } | null | undefined;
}) {
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
  line: { id: string; ingredientId: string; quantity: number; unit: string };
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
            <form action={confirmProductChoice}>
              <input type="hidden" name="lineId" value={line.id} />
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="householdId" value={householdId} />
              <button
                type="submit"
                className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink hover:opacity-90"
              >
                {selected ? "Goed, onthouden" : "Kies en onthoud"}
              </button>
            </form>
            <form action={useProductThisWeekOnly}>
              <input type="hidden" name="lineId" value={line.id} />
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="householdId" value={householdId} />
              <button
                type="submit"
                className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:border-accent/50"
              >
                Alleen deze week
              </button>
            </form>
            <form action={rejectProductChoice}>
              <input type="hidden" name="lineId" value={line.id} />
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="householdId" value={householdId} />
              <button
                type="submit"
                className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-faint hover:border-red-300 hover:text-red-600"
              >
                Nooit
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function LineControlCard({
  line,
  candidates,
  householdId,
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
  };
  candidates: ProductCardProduct[];
  householdId: string;
}) {
  const alternatives = candidates.filter((candidate) => candidate.id !== line.product?.id);

  return (
    <div
      className={`min-w-0 rounded-xl border p-4 ${
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
        <button
          type="submit"
          className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:border-accent/50"
        >
          Hoeveelheid
        </button>
      </form>

      <form action={searchPicnicProductsForLine} className="mb-3 flex min-w-0 gap-2">
        <input type="hidden" name="lineId" value={line.id} />
        <input
          name="query"
          placeholder={`Zoek Picnic-product, bv. ${line.ingredient.name}`}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
        <button
          type="submit"
          aria-label="Zoeken bij Picnic"
          title="Zoeken bij Picnic"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink hover:border-accent/50"
        >
          <Search size={16} />
        </button>
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
          <details className="rounded-lg border border-line bg-surface p-3">
            <summary className="cursor-pointer text-sm font-medium text-ink">
              {alternatives.length} alternatief{alternatives.length === 1 ? "" : "en"}
            </summary>
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
            <button
              type="submit"
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink"
            >
              Zonder product doorgaan
            </button>
          </form>
          <form action={removeLineFromList}>
            <input type="hidden" name="lineId" value={line.id} />
            <button
              type="submit"
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink-faint hover:text-red-600"
            >
              Van lijst verwijderen
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default async function ControlePage() {
  const household = await requireCurrentHousehold();

  const weekStart = getCurrentWeekStart();
  const mealPlan = await getMealPlanForWeek(household.id, weekStart);
  if (!mealPlan) redirect("/");

  const shoppingList = await ensureShoppingList(mealPlan.id, household.id);

  const trustedLines = shoppingList.lines.filter((l) => !l.needsReview);
  const reviewLines = shoppingList.lines.filter((l) => l.needsReview);
  const lines = [...shoppingList.lines].sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name));

  const candidatesByLine = new Map<string, Awaited<ReturnType<typeof getShoppingListCandidates>>>();
  for (const line of lines) {
    candidatesByLine.set(line.id, await getShoppingListCandidates(household.id, line.ingredientId));
  }

  // Fase 6: "niet gevonden" is een apart geval van "aandacht nodig" — geen
  // enkel bekend product om uit te kiezen, dus andere acties dan een
  // twijfelgeval met wél kandidaten.
  const notFoundLines = reviewLines.filter((l) => (candidatesByLine.get(l.id) ?? []).length === 0);
  const attentionLines = reviewLines.filter((l) => (candidatesByLine.get(l.id) ?? []).length > 0);

  return (
    <div className="mx-auto flex min-h-screen w-full min-w-0 max-w-2xl flex-col pb-24">
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
          Ik heb {shoppingList.lines.length} producten voorbereid op basis van jullie weekplanning.
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

        <div className="mb-8 grid gap-4">
          {lines.map((line) => (
            <LineControlCard
              key={line.id}
              line={line}
              candidates={candidatesByLine.get(line.id) ?? []}
              householdId={household.id}
            />
          ))}
        </div>

        <form action={confirmShoppingList}>
          <input type="hidden" name="shoppingListId" value={shoppingList.id} />
          <button
            type="submit"
            disabled={reviewLines.length > 0}
            className="w-full rounded-xl bg-accent px-4 py-3.5 text-center font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {reviewLines.length > 0 ? "Los eerst de twijfelgevallen op" : "Bevestigen"}
          </button>
        </form>
      </div>

      <NavBar />
    </div>
  );
}
