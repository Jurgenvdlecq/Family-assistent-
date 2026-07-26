import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ShoppingCart, CheckCircle2, Utensils, ChevronRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getMealPlanForWeek } from "@/lib/mealPlan";
import { getCurrentWeekStart } from "@/lib/week";
import { ensureShoppingList } from "@/lib/shoppingList";
import { getFixedGroceries, getIngredientsWithoutFixedGrocery } from "@/lib/fixedGroceries";
import { preparePicnicTransfer } from "@/lib/picnicAdapter";
import NavBar from "@/components/NavBar";
import PicnicTransfer from "./PicnicTransfer";
import AddToPicnicCart from "./AddToPicnicCart";
import {
  removeFixedLineThisWeek,
  restoreFixedLineThisWeek,
  updateFixedLineQuantity,
  addFixedGrocery,
  removeFixedGroceryPermanently,
} from "./fixedGroceriesActions";

const UNIT_LABELS: Record<string, string> = { GRAM: "gram", ML: "ml", PIECE: "stuks" };

// ensureShoppingList schrijft (idempotent) naar de database — nooit
// statisch prerenderen tijdens de build.
export const dynamic = "force-dynamic";

function formatQuantity(quantity: number, unit: string) {
  if (unit === "GRAM") return `${quantity} g`;
  if (unit === "ML") return `${quantity} ml`;
  return `${quantity}x`;
}

export default async function BoodschappenPage() {
  const household = await prisma.household.findFirst({ orderBy: { createdAt: "asc" } });
  if (!household) redirect("/onboarding");

  const weekStart = getCurrentWeekStart();
  const mealPlan = await getMealPlanForWeek(household.id, weekStart);
  if (!mealPlan) redirect("/");

  const shoppingList = await ensureShoppingList(mealPlan.id, household.id);
  const sortedLines = [...shoppingList.lines].sort((a, b) =>
    a.ingredient.name.localeCompare(b.ingredient.name)
  );
  const mealLines = sortedLines.filter((l) => l.source === "MEAL");
  const activeFixedLines = sortedLines.filter((l) => l.source === "FIXED");
  const reviewCount = sortedLines.filter((l) => l.needsReview).length;
  const picnicTransfer = await preparePicnicTransfer(shoppingList.id);

  const [fixedGroceries, availableIngredients] = await Promise.all([
    getFixedGroceries(household.id),
    getIngredientsWithoutFixedGrocery(household.id),
  ]);
  const activeIngredientIds = new Set(activeFixedLines.map((l) => l.ingredientId));
  const inactiveFixedItems = fixedGroceries.filter((f) => !activeIngredientIds.has(f.ingredientId));

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
        <h2 className="mb-3 text-sm font-semibold text-ink">Deze week nodig</h2>
        <div className="flex min-w-0 flex-col divide-y divide-line rounded-xl border border-line bg-surface">
          {mealLines.map((line) => (
            <div key={line.id} className="flex min-w-0 items-center justify-between gap-4 p-4">
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
              <span className="shrink-0 text-sm text-ink-muted">
                {formatQuantity(line.quantity, line.unit)}
              </span>
            </div>
          ))}
        </div>

        <h2 className="mb-3 mt-8 text-sm font-semibold text-ink">Vaste boodschappen</h2>
        <div className="flex min-w-0 flex-col divide-y divide-line rounded-xl border border-line bg-surface">
          {activeFixedLines.length === 0 && inactiveFixedItems.length === 0 && (
            <p className="p-4 text-sm text-ink-muted">
              Nog geen vaste boodschappen ingesteld — voeg hieronder je eerste toe.
            </p>
          )}
          {activeFixedLines.map((line) => (
            <div key={line.id} className="flex min-w-0 flex-col gap-2 p-4">
              <div className="flex min-w-0 items-center justify-between gap-4">
                <p className="min-w-0 truncate text-ink">{line.product?.name ?? line.ingredient.name}</p>
                <form action={removeFixedLineThisWeek}>
                  <input type="hidden" name="lineId" value={line.id} />
                  <button
                    type="submit"
                    className="shrink-0 text-xs font-medium text-ink-faint hover:text-ink"
                  >
                    Deze week niet nodig
                  </button>
                </form>
              </div>
              <form action={updateFixedLineQuantity} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="lineId" value={line.id} />
                <input
                  type="number"
                  name="quantity"
                  defaultValue={line.quantity}
                  step="any"
                  min="0.01"
                  className="w-20 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
                />
                <span className="text-xs text-ink-faint">{UNIT_LABELS[line.unit] ?? line.unit}</span>
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
          ))}
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

        <details className="mt-4 rounded-xl border border-line bg-surface p-4">
          <summary className="cursor-pointer text-sm font-medium text-ink">
            Nieuwe vaste boodschap toevoegen
          </summary>
          {availableIngredients.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">
              Alle ingrediënten staan al op de vaste lijst.
            </p>
          ) : (
            <form action={addFixedGrocery} className="mt-3 flex flex-wrap items-center gap-2">
              <input type="hidden" name="householdId" value={household.id} />
              <input type="hidden" name="shoppingListId" value={shoppingList.id} />
              <select
                name="ingredientId"
                required
                defaultValue=""
                className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              >
                <option value="" disabled>
                  Kies een ingrediënt…
                </option>
                {availableIngredients.map((ing) => (
                  <option key={ing.id} value={ing.id}>
                    {ing.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                name="quantity"
                placeholder="Aantal"
                step="any"
                min="0.01"
                required
                className="w-20 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              />
              <select
                name="unit"
                required
                defaultValue="PIECE"
                className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              >
                <option value="PIECE">stuks</option>
                <option value="GRAM">gram</option>
                <option value="ML">ml</option>
              </select>
              <button
                type="submit"
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90"
              >
                Toevoegen
              </button>
            </form>
          )}
        </details>

        <details className="mt-6 rounded-xl border border-line bg-surface p-4">
          <summary className="cursor-pointer font-medium text-ink">Per maaltijd bekijken</summary>
          <div className="mt-4 flex flex-col gap-4">
            {mealPlan.entries.map((entry) => (
              <div key={entry.id} className="min-w-0">
                <p className="mb-1 text-sm font-medium text-ink">{entry.recipeVariant.recipe.title}</p>
                <ul className="text-sm text-ink-muted">
                  {entry.recipeVariant.recipe.ingredients.map((ri) => (
                    <li key={ri.id}>
                      {ri.ingredient.name} — {formatQuantity(ri.quantity, ri.unit)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>

        <PicnicTransfer
          shoppingListId={shoppingList.id}
          text={picnicTransfer.text}
          itemCount={picnicTransfer.itemCount}
          transferred={picnicTransfer.status === "TRANSFERRED"}
        />
        <AddToPicnicCart
          shoppingListId={shoppingList.id}
          connected={Boolean(household.picnicAuthToken)}
        />
      </div>

      <NavBar />
    </div>
  );
}
