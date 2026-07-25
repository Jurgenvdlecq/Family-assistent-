import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getMealPlanForWeek } from "@/lib/mealPlan";
import { getCurrentWeekStart } from "@/lib/week";
import { ensureShoppingList } from "@/lib/shoppingList";
import { preparePicnicTransfer } from "@/lib/picnicAdapter";
import NavBar from "@/components/NavBar";
import PicnicTransfer from "./PicnicTransfer";
import AddToPicnicCart from "./AddToPicnicCart";

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
  const reviewCount = sortedLines.filter((l) => l.needsReview).length;
  const picnicTransfer = await preparePicnicTransfer(shoppingList.id);

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10 pb-24">
      <p className="mb-1 font-mono text-xs uppercase tracking-wide text-orange-600">Boodschappen</p>
      <h1 className="mb-2 text-2xl font-semibold">Jullie boodschappen staan klaar</h1>
      <p className="mb-6 text-neutral-600 dark:text-neutral-400">
        {sortedLines.length} producten verzameld uit {mealPlan.entries.length} maaltijden deze
        week.
      </p>

      {reviewCount > 0 && (
        <a
          href="/controle"
          className="mb-6 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-400"
        >
          <span>{reviewCount} product(en) vragen jullie aandacht</span>
          <span>Naar Controle →</span>
        </a>
      )}

      <div className="flex flex-col divide-y divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {sortedLines.map((line) => (
          <div key={line.id} className="flex items-center justify-between gap-4 p-4">
            <div>
              <p>{line.product?.name ?? line.ingredient.name}</p>
              {line.product?.brand && (
                <p className="text-xs text-neutral-400">
                  {line.product.brand}
                  {line.product.packageSize ? ` · ${line.product.packageSize}` : ""}
                </p>
              )}
              {line.needsReview && (
                <p className="mt-0.5 text-xs font-medium text-amber-600">Nog te bevestigen</p>
              )}
            </div>
            <span className="shrink-0 text-sm text-neutral-500">
              {formatQuantity(line.quantity, line.unit)}
            </span>
          </div>
        ))}
      </div>

      <details className="mt-8 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <summary className="cursor-pointer font-medium">Per maaltijd bekijken</summary>
        <div className="mt-4 flex flex-col gap-4">
          {mealPlan.entries.map((entry) => (
            <div key={entry.id}>
              <p className="mb-1 text-sm font-medium">{entry.recipeVariant.recipe.title}</p>
              <ul className="text-sm text-neutral-500">
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

      <NavBar />
    </div>
  );
}
