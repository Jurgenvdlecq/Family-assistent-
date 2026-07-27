import Link from "next/link";
import { ChevronLeft, BookOpen, Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireCurrentHousehold } from "@/lib/auth";
import { CATEGORY_LABELS, STATUS_LABELS, VARIANT_LABELS } from "@/lib/categoryStyle";
import NavBar from "@/components/NavBar";
import {
  createIngredient,
  createRecipe,
  createRecipeVariant,
  updateIngredient,
  updateRecipeDetails,
  updateRecipeIngredients,
  updateRecipeVariant,
} from "./actions";

export const dynamic = "force-dynamic";

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS);
const STATUS_OPTIONS = Object.entries(STATUS_LABELS);
const VARIANT_OPTIONS = Object.entries(VARIANT_LABELS);
const UNIT_LABELS: Record<string, string> = { GRAM: "g", ML: "ml", PIECE: "x" };
const INGREDIENT_CATEGORY_LABELS: Record<string, string> = {
  MEAT: "Vlees",
  FISH: "Vis",
  DAIRY: "Zuivel",
  VEGETABLE: "Groente",
  FRUIT: "Fruit",
  GRAIN: "Graan",
  LEGUME: "Peulvrucht",
  PANTRY: "Voorraadkast",
  OTHER: "Overig",
};
const INGREDIENT_CATEGORY_OPTIONS = Object.entries(INGREDIENT_CATEGORY_LABELS);
const UNIT_OPTIONS = Object.entries(UNIT_LABELS);

function IngredientRows({
  ingredients,
  recipeIngredients = [],
  minRows = 8,
}: {
  ingredients: Awaited<ReturnType<typeof prisma.ingredient.findMany>>;
  recipeIngredients?: {
    ingredientId: string;
    quantity: number;
  }[];
  minRows?: number;
}) {
  const rowCount = Math.max(minRows, recipeIngredients.length + 3);

  return (
    <div className="grid gap-2">
      <input type="hidden" name="ingredientRowCount" value={rowCount} />
      {Array.from({ length: rowCount }, (_, index) => {
        const current = recipeIngredients[index];
        return (
          <div key={index} className="grid grid-cols-[1fr_92px] gap-2">
            <select
              name={`ingredientId-${index}`}
              defaultValue={current?.ingredientId ?? ""}
              className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            >
              <option value="">Ingrediënt</option>
              {ingredients.map((ingredient) => (
                <option key={ingredient.id} value={ingredient.id}>
                  {ingredient.name} ({UNIT_LABELS[ingredient.unit] ?? ingredient.unit})
                </option>
              ))}
            </select>
            <input
              type="number"
              name={`quantity-${index}`}
              min="0"
              step="0.01"
              defaultValue={current?.quantity ?? ""}
              placeholder="Hoeveel"
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          </div>
        );
      })}
    </div>
  );
}

export default async function ReceptenPage() {
  const household = await requireCurrentHousehold();
  const [recipes, ingredients] = await Promise.all([
    prisma.recipe.findMany({
      include: {
        ingredients: { include: { ingredient: true }, orderBy: { ingredient: { name: "asc" } } },
        variants: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { title: "asc" },
    }),
    prisma.ingredient.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="mx-auto flex min-h-screen w-full min-w-0 max-w-2xl flex-col pb-24">
      <header className="flex items-center justify-between px-6 pt-6 pb-2">
        <Link href="/" aria-label="Terug naar Jouw week" className="text-ink-muted">
          <ChevronLeft size={22} />
        </Link>
        <span className="text-sm font-semibold">Recepten</span>
        <BookOpen size={18} className="text-ink-muted" />
      </header>

      <div className="min-w-0 px-6 pt-4">
        <h1 className="mb-1 text-[1.6rem] font-semibold leading-tight text-ink">Recepten beheren</h1>
        <p className="mb-6 text-[15px] text-ink-muted">
          Voeg recepten toe of corrigeer hoe de planner ze gebruikt.
        </p>

        <details className="mb-4 min-w-0 rounded-xl border border-line bg-surface p-4">
          <summary className="flex cursor-pointer items-center gap-2 font-medium text-ink">
            <Plus size={16} className="text-accent" />
            Nieuw ingrediënt
          </summary>
          <form action={createIngredient} className="mt-4 grid gap-3">
            <input type="hidden" name="householdId" value={household.id} />
            <input
              name="name"
              required
              placeholder="Bijv. aardappelpartjes diepvries"
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <div className="grid grid-cols-2 gap-2">
              <select name="unit" defaultValue="GRAM" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink">
                {UNIT_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <select name="category" defaultValue="OTHER" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink">
                {INGREDIENT_CATEGORY_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <input
              name="restrictionTags"
              placeholder="Dieettags, gescheiden met komma's"
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              <input type="checkbox" name="likelyInStock" className="h-4 w-4 accent-accent" />
              Vaak al in huis / voorraadcontrole
            </label>
            <button type="submit" className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink">
              Ingrediënt toevoegen
            </button>
          </form>
        </details>

        <details className="mb-8 min-w-0 rounded-xl border border-line bg-surface p-4">
          <summary className="font-medium text-ink">Ingrediënten beheren</summary>
          <div className="mt-4 grid gap-3">
            {ingredients.map((ingredient) => (
              <form key={ingredient.id} action={updateIngredient} className="grid gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
                <input type="hidden" name="householdId" value={household.id} />
                <input type="hidden" name="ingredientId" value={ingredient.id} />
                <div className="grid grid-cols-[1fr_112px] gap-2">
                  <input
                    name="name"
                    defaultValue={ingredient.name}
                    required
                    className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  />
                  <div className="rounded-lg border border-line px-3 py-2 text-sm text-ink-muted">
                    {UNIT_LABELS[ingredient.unit] ?? ingredient.unit}
                  </div>
                </div>
                <select name="category" defaultValue={ingredient.category} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink">
                  {INGREDIENT_CATEGORY_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <input
                  name="restrictionTags"
                  defaultValue={ingredient.restrictionTags.join(", ")}
                  placeholder="Dieettags"
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                />
                <div className="flex items-center justify-between gap-3">
                  <label className="flex min-w-0 items-center gap-2 text-sm text-ink-muted">
                    <input
                      type="checkbox"
                      name="likelyInStock"
                      defaultChecked={ingredient.likelyInStock}
                      className="h-4 w-4 accent-accent"
                    />
                    Voorraadcontrole
                  </label>
                  <button type="submit" className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-muted hover:border-accent hover:text-accent">
                    Opslaan
                  </button>
                </div>
              </form>
            ))}
          </div>
        </details>

        <details className="mb-8 min-w-0 rounded-xl border border-line bg-surface p-4">
          <summary className="flex cursor-pointer items-center gap-2 font-medium text-ink">
            <Plus size={16} className="text-accent" />
            Nieuw recept
          </summary>
          <form action={createRecipe} className="mt-4 grid min-w-0 gap-3">
            <input type="hidden" name="householdId" value={household.id} />
            <input
              name="title"
              required
              placeholder="Naam van het recept"
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <div className="grid grid-cols-2 gap-2">
              <select name="category" defaultValue="OTHER" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink">
                {CATEGORY_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <select name="variantType" defaultValue="FRESH" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink">
                {VARIANT_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <input
              name="source"
              placeholder="Bron of notitie"
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <textarea
              name="properties"
              rows={2}
              placeholder="Eigenschappen, gescheiden met komma's of regels"
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <textarea
              name="contextFit"
              rows={2}
              placeholder="Planner-signalen, bv. drukke_dag, kindvriendelijk"
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <textarea
              name="instructions"
              rows={3}
              placeholder="Bereiding, één stap per regel"
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />

            <IngredientRows ingredients={ingredients} />

            <button type="submit" className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink">
              Recept toevoegen
            </button>
          </form>
        </details>

        <div className="mb-8 grid gap-3">
          {recipes.map((recipe) => {
            return (
              <article key={recipe.id} className="min-w-0 rounded-xl border border-line bg-surface p-4">
                <div className="mb-3 min-w-0">
                  <h2 className="truncate font-semibold text-ink">{recipe.title}</h2>
                  <p className="text-xs text-ink-faint">
                    {recipe.ingredients.length} ingrediënten · {recipe.variants.length} varianten
                  </p>
                </div>
                <p className="mb-3 text-sm text-ink-muted">
                  {recipe.ingredients
                    .slice(0, 5)
                    .map((ri) => `${ri.ingredient.name} ${ri.quantity}${UNIT_LABELS[ri.unit] ?? ri.unit}`)
                    .join(", ")}
                </p>
                <form action={updateRecipeDetails} className="grid gap-2">
                  <input type="hidden" name="householdId" value={household.id} />
                  <input type="hidden" name="recipeId" value={recipe.id} />
                  <input
                    name="title"
                    defaultValue={recipe.title}
                    required
                    className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select name="category" defaultValue={recipe.category} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink">
                      {CATEGORY_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <select name="status" defaultValue={recipe.status} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink">
                      {STATUS_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <input
                    name="source"
                    defaultValue={recipe.source ?? ""}
                    placeholder="Bron of notitie"
                    className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  />
                  <textarea
                    name="properties"
                    rows={2}
                    defaultValue={recipe.properties.join(", ")}
                    placeholder="Eigenschappen"
                    className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  />
                  <textarea
                    name="instructions"
                    rows={3}
                    defaultValue={recipe.instructions.join("\n")}
                    placeholder="Bereiding"
                    className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  />
                  <button type="submit" className="w-fit rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-muted hover:border-accent hover:text-accent">
                    Recept opslaan
                  </button>
                </form>

                <div className="mt-4 grid gap-2 border-t border-line pt-4">
                  <h3 className="text-xs font-semibold text-ink-faint">Ingrediënten</h3>
                  <form action={updateRecipeIngredients} className="grid gap-2">
                    <input type="hidden" name="householdId" value={household.id} />
                    <input type="hidden" name="recipeId" value={recipe.id} />
                    <IngredientRows
                      ingredients={ingredients}
                      recipeIngredients={recipe.ingredients.map((ri) => ({ ingredientId: ri.ingredientId, quantity: ri.quantity }))}
                      minRows={recipe.ingredients.length}
                    />
                    <button type="submit" className="w-fit rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-muted hover:border-accent hover:text-accent">
                      Ingrediënten opslaan
                    </button>
                  </form>
                </div>

                <div className="mt-4 grid gap-2 border-t border-line pt-4">
                  <h3 className="text-xs font-semibold text-ink-faint">Varianten</h3>
                  {recipe.variants.map((variant) => (
                    <form key={variant.id} action={updateRecipeVariant} className="grid gap-2">
                      <input type="hidden" name="householdId" value={household.id} />
                      <input type="hidden" name="variantId" value={variant.id} />
                      <div className="text-sm font-medium text-ink">{VARIANT_LABELS[variant.variantType]}</div>
                      <input
                        name="contextFit"
                        defaultValue={variant.contextFit.join(", ")}
                        placeholder="Context-signalen, bv. drukke_dag, kindvriendelijk"
                        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                      />
                      <button type="submit" className="w-fit rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-muted hover:border-accent hover:text-accent">
                        Variant opslaan
                      </button>
                    </form>
                  ))}

                  <details className="pt-2">
                    <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-accent">
                      <Plus size={15} />
                      Variant toevoegen
                    </summary>
                    <form action={createRecipeVariant} className="mt-3 grid gap-2">
                      <input type="hidden" name="householdId" value={household.id} />
                      <input type="hidden" name="recipeId" value={recipe.id} />
                      <select name="variantType" defaultValue="FAST" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink">
                        {VARIANT_OPTIONS.map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                      <input
                        name="contextFit"
                        placeholder="Context-signalen"
                        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                      />
                      <button type="submit" className="w-fit rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-ink">
                        Variant toevoegen
                      </button>
                    </form>
                  </details>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <NavBar />
    </div>
  );
}
