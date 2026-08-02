import Link from "next/link";
import { ChevronLeft, BookOpen, Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireCurrentHousehold } from "@/lib/auth";
import { CATEGORY_LABELS, STATUS_LABELS, VARIANT_LABELS } from "@/lib/categoryStyle";
import { accessibleRecipeWhere } from "@/lib/recipeScope";
import { picnicImageUrl } from "@/lib/picnic/products";
import NavBar from "@/components/NavBar";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import {
  allowProductForIngredient,
  copyRecipeToHousehold,
  createIngredient,
  createIngredientProduct,
  createQuickRecipe,
  createRecipe,
  createRecipeVariant,
  deleteRecipe,
  importRecipeFromUrl,
  rejectProductForIngredient,
  setDefaultProductForIngredient,
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

const ERROR_STATUS_MESSAGES: Record<string, string> = {
  "import-url-missing": "Vul een link naar een recept in.",
  "import-url-invalid": "Dit is geen geldige link.",
  "import-url-blocked": "Deze link wijst niet naar een normale website.",
  "import-url-unreachable": "Kon deze pagina niet ophalen. Probeer het later opnieuw, of plak de tekst hieronder handmatig.",
  "import-no-recipe-found":
    'Kon dit recept niet automatisch herkennen op deze pagina. Plak de ingrediënten hieronder handmatig bij "Nieuw recept snel toevoegen".',
  "import-no-ingredients": "Kon geen ingrediënten herkennen op deze pagina. Plak de tekst hieronder handmatig.",
  "import-duplicate-title": "Er bestaat al een eigen recept met deze titel.",
  "import-failed": "Dit recept kon niet geïmporteerd worden. Probeer het opnieuw of plak de tekst handmatig.",
};

const STATUS_MESSAGES: Record<string, string> = {
  "recipe-created": "Recept toegevoegd.",
  "recipe-imported": "Recept geïmporteerd — controleer de ingrediënten en pas aan waar nodig.",
  "recipe-updated": "Recept opgeslagen.",
  "recipe-deleted": "Recept verwijderd.",
  "ingredients-updated": "Ingrediënten opgeslagen.",
  "variant-updated": "Variant opgeslagen.",
  "variant-created": "Variant toegevoegd.",
  "recipe-copied": "Eigen kopie gemaakt.",
  "ingredient-created": "Ingrediënt toegevoegd.",
  "ingredient-updated": "Ingrediënt opgeslagen.",
  "product-created": "Product toegevoegd.",
  "product-default": "Standaardproduct opgeslagen.",
  "product-rejected": "Product uitgesloten.",
  "product-allowed": "Product weer toegestaan.",
};

function formatPrice(price: unknown) {
  if (price === null || price === undefined) return null;
  return `€ ${Number(price).toFixed(2)}`;
}

function ProductImage({
  product,
}: {
  product: { name: string; picnicImageId: string | null };
}) {
  const imageUrl = picnicImageUrl(product.picnicImageId, "small");
  return (
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-line bg-white bg-contain bg-center bg-no-repeat text-ink-faint"
      style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}
      aria-label={product.name}
    >
      {!imageUrl && <BookOpen size={15} />}
    </div>
  );
}

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

export default async function ReceptenPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const params = await searchParams;
  const searchQuery = String(params.q ?? "").trim();
  const normalizedQuery = searchQuery.toLowerCase();
  const statusMessage = params.status ? STATUS_MESSAGES[params.status] : undefined;
  const errorMessage = params.status ? ERROR_STATUS_MESSAGES[params.status] : undefined;
  const household = await requireCurrentHousehold();
  const [recipes, ingredients] = await Promise.all([
    prisma.recipe.findMany({
      where: accessibleRecipeWhere(household.id),
      include: {
        ingredients: { include: { ingredient: true }, orderBy: { ingredient: { name: "asc" } } },
        variants: { orderBy: { createdAt: "asc" } },
      },
      orderBy: [{ householdId: "desc" }, { title: "asc" }],
    }),
    prisma.ingredient.findMany({
      include: {
        products: {
          include: {
            householdPreferences: { where: { householdId: household.id } },
            rejections: { where: { householdId: household.id } },
          },
          orderBy: [{ lastSeenAvailable: "desc" }, { name: "asc" }],
        },
      },
      orderBy: { name: "asc" },
    }),
  ]);
  const visibleRecipes = normalizedQuery
    ? recipes.filter(
        (recipe) =>
          recipe.title.toLowerCase().includes(normalizedQuery) ||
          recipe.ingredients.some((ri) => ri.ingredient.name.toLowerCase().includes(normalizedQuery))
      )
    : recipes;

  return (
    <div className="mx-auto flex min-h-screen w-full min-w-0 max-w-2xl flex-col pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between px-6 pt-6 pb-2">
        <Link href="/" aria-label="Terug naar Jouw week" className="text-ink-muted">
          <ChevronLeft size={22} />
        </Link>
        <span className="text-sm font-semibold">Recepten</span>
        <BookOpen size={18} className="text-ink-muted" />
      </header>

      <div className="flex min-w-0 flex-col px-6 pt-4">
        {statusMessage && (
          <p className="mb-4 rounded-lg border border-tag-green-ink/20 bg-tag-green-bg px-3 py-2 text-sm font-medium text-tag-green-ink">
            {statusMessage}
          </p>
        )}
        {errorMessage && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {errorMessage}
          </p>
        )}
        <h1 className="mb-1 text-[1.6rem] font-semibold leading-tight text-ink">Recepten</h1>
        <p className="mb-6 text-[15px] text-ink-muted">
          Bekijk wat de assistent kan plannen. Bewerken en technisch beheer staan rustig ingeklapt.
        </p>

        <details className="order-3 mb-8 min-w-0 rounded-xl border border-line bg-surface p-4">
          <summary className="cursor-pointer font-medium text-ink">Geavanceerd ingrediënt- en productbeheer</summary>
          <div className="mt-4 grid gap-4">
        <details className="min-w-0 rounded-xl border border-line bg-surface p-4">
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
            <PendingSubmitButton pendingText="Toevoegen..." className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink">
              Ingrediënt toevoegen
            </PendingSubmitButton>
          </form>
        </details>

        <details className="min-w-0 rounded-xl border border-line bg-surface p-4">
          <summary className="font-medium text-ink">Ingrediënten beheren</summary>
          <div className="mt-4 grid gap-3">
            {ingredients.map((ingredient) => {
              const defaultProductId = ingredient.products.find((product) => product.householdPreferences.length > 0)?.id;
              return (
                <div key={ingredient.id} className="grid gap-3 border-t border-line pt-3 first:border-t-0 first:pt-0">
                  <form action={updateIngredient} className="grid gap-2">
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
                    {/*
                      Categorie en dieettags bepalen de harde allergie-/
                      dieetfiltering (src/lib/dietaryRestrictions.ts) voor
                      ALLE huishoudens die dit gedeelde ingrediënt gebruiken
                      — Ingredient heeft geen householdId, dus deze twee
                      velden zijn hier bewust alleen-lezen (SYSTEM_AUDIT.md,
                      bevinding 3). updateIngredient negeert deze velden nu
                      ook server-side, ongeacht wat een formulier zou sturen.
                    */}
                    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-muted">
                      {INGREDIENT_CATEGORY_LABELS[ingredient.category] ?? ingredient.category}
                      {ingredient.restrictionTags.length > 0 && ` · ${ingredient.restrictionTags.join(", ")}`}
                    </div>
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
                      <PendingSubmitButton pendingText="Opslaan..." className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-muted hover:border-accent hover:text-accent">
                        Opslaan
                      </PendingSubmitButton>
                    </div>
                  </form>

                  <details className="rounded-lg border border-line p-3">
                    <summary className="cursor-pointer text-sm font-medium text-ink">
                      {ingredient.products.length} productkeuzes
                    </summary>
                    <div className="mt-3 grid gap-2">
                      {ingredient.products.map((product) => {
                        const isDefault = product.id === defaultProductId;
                        const isRejected = product.rejections.length > 0;
                        return (
                          <div key={product.id} className="grid gap-2 rounded-lg border border-line p-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <ProductImage product={product} />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-ink">
                                  {product.name}
                                  {product.brand && <span className="text-ink-faint"> - {product.brand}</span>}
                                </p>
                                <p className="truncate text-xs text-ink-faint">
                                  {[product.packageSize, formatPrice(product.price), product.externalRef ? "Picnic-id bekend" : null]
                                    .filter(Boolean)
                                    .join(" · ") || "Geen extra productinfo"}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {isDefault ? (
                                <span className="rounded-md bg-tag-green-bg px-2 py-1 text-xs font-medium text-tag-green-ink">
                                  Standaard
                                </span>
                              ) : (
                                <form action={setDefaultProductForIngredient}>
                                  <input type="hidden" name="householdId" value={household.id} />
                                  <input type="hidden" name="ingredientId" value={ingredient.id} />
                                  <input type="hidden" name="productId" value={product.id} />
                                  <PendingSubmitButton pendingText="Bezig..." className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink-muted hover:border-accent hover:text-accent">
                                    Maak standaard
                                  </PendingSubmitButton>
                                </form>
                              )}
                              {isRejected ? (
                                <form action={allowProductForIngredient}>
                                  <input type="hidden" name="householdId" value={household.id} />
                                  <input type="hidden" name="ingredientId" value={ingredient.id} />
                                  <input type="hidden" name="productId" value={product.id} />
                                  <PendingSubmitButton pendingText="Bezig..." className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink-muted hover:border-accent hover:text-accent">
                                    Weer toestaan
                                  </PendingSubmitButton>
                                </form>
                              ) : (
                                <form action={rejectProductForIngredient}>
                                  <input type="hidden" name="householdId" value={household.id} />
                                  <input type="hidden" name="ingredientId" value={ingredient.id} />
                                  <input type="hidden" name="productId" value={product.id} />
                                  <PendingSubmitButton pendingText="Bezig..." className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink-faint hover:border-red-300 hover:text-red-600">
                                    Uitsluiten
                                  </PendingSubmitButton>
                                </form>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      <details className="pt-1">
                        <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-accent">
                          <Plus size={15} />
                          Product toevoegen
                        </summary>
                        <form action={createIngredientProduct} className="mt-3 grid gap-2">
                          <input type="hidden" name="householdId" value={household.id} />
                          <input type="hidden" name="ingredientId" value={ingredient.id} />
                          <input
                            name="name"
                            required
                            placeholder="Productnaam"
                            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              name="brand"
                              placeholder="Merk"
                              className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                            />
                            <input
                              name="packageSize"
                              placeholder="Bijv. 750 g"
                              className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              name="price"
                              inputMode="decimal"
                              placeholder="Prijs"
                              className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                            />
                            <input
                              name="externalRef"
                              placeholder="Picnic-id"
                              className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                            />
                          </div>
                          <label className="flex items-center gap-2 text-sm text-ink-muted">
                            <input type="checkbox" name="setAsDefault" className="h-4 w-4 accent-accent" />
                            Meteen standaard maken
                          </label>
                          <PendingSubmitButton pendingText="Toevoegen..." className="w-fit rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-ink">
                            Product toevoegen
                          </PendingSubmitButton>
                        </form>
                      </details>
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        </details>
          </div>
        </details>

        <section className="order-1 mb-5 min-w-0 rounded-xl border border-line bg-surface p-4">
          <div className="mb-4 flex items-center gap-2 font-medium text-ink">
            <Plus size={16} className="text-accent" />
            Recept importeren via link
          </div>
          <form action={importRecipeFromUrl} className="grid min-w-0 gap-3">
            <input type="hidden" name="householdId" value={household.id} />
            <input
              name="url"
              type="url"
              required
              placeholder="https://voorbeeld.nl/recept/kip-curry"
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <p className="text-xs text-ink-muted">
              Werkt bij de meeste receptensites. Lukt het niet, plak dan de tekst hieronder bij &quot;Snel toevoegen&quot;.
            </p>
            <PendingSubmitButton pendingText="Importeren..." className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent/90">
              Importeren
            </PendingSubmitButton>
          </form>
        </section>

        <section className="order-1 mb-5 min-w-0 rounded-xl border border-line bg-surface p-4">
          <div className="mb-4 flex items-center gap-2 font-medium text-ink">
            <Plus size={16} className="text-accent" />
            Nieuw recept snel toevoegen
          </div>
          <form action={createQuickRecipe} className="grid min-w-0 gap-3">
            <input type="hidden" name="householdId" value={household.id} />
            <input
              name="title"
              required
              placeholder="Bijv. Kip met rijst en paprika"
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <textarea
              name="ingredientText"
              required
              rows={7}
              placeholder={"400g kipfilet\n300 gram rijst\n2 paprika\n1 ui\n250 ml kookroom"}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <PendingSubmitButton pendingText="Opslaan..." className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent/90">
              Recept opslaan en producten zoeken
            </PendingSubmitButton>
          </form>
        </section>

        <details className="order-1 mb-5 min-w-0 rounded-xl border border-line bg-surface p-4">
          <summary className="flex cursor-pointer items-center gap-2 font-medium text-ink">
            <Plus size={16} className="text-accent" />
            Geavanceerd recept toevoegen
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

            <PendingSubmitButton pendingText="Toevoegen..." className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink">
              Recept toevoegen
            </PendingSubmitButton>
          </form>
        </details>

        <div className="order-2 mb-8 grid gap-3">
          <form action="/recepten" className="mb-1 flex min-w-0 gap-2">
            <input
              name="q"
              defaultValue={searchQuery}
              placeholder="Zoek op receptnaam of ingrediënt"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <button
              type="submit"
              className="shrink-0 rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-muted hover:border-accent hover:text-accent"
            >
              Zoeken
            </button>
          </form>
          {searchQuery && (
            <p className="mb-1 text-xs text-ink-muted">
              {visibleRecipes.length === 0
                ? `Geen recepten gevonden voor "${searchQuery}".`
                : `${visibleRecipes.length} van ${recipes.length} recepten voor "${searchQuery}".`}{" "}
              <Link href="/recepten" className="font-medium text-accent underline decoration-dotted">
                Wis zoekopdracht
              </Link>
            </p>
          )}
          {visibleRecipes.map((recipe) => {
            const editable = recipe.householdId === household.id;
            const scopeLabel = editable
              ? "Eigen recept"
              : recipe.scope === "COMMUNITY_APPROVED"
                ? "Gedeeld basisrecept"
                : "Basisrecept";
            return (
              <article key={recipe.id} className="min-w-0 rounded-xl border border-line bg-surface p-4">
                <div className="mb-3 flex min-w-0 items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
                      <h2 className="truncate font-semibold text-ink">{recipe.title}</h2>
                      <span className="shrink-0 rounded-md bg-tag-blue-bg px-2 py-1 text-[11px] font-medium text-tag-blue-ink">
                        {scopeLabel}
                      </span>
                    </div>
                    <p className="text-xs text-ink-faint">
                      {recipe.ingredients.length} ingrediënten · {recipe.variants.length} varianten
                    </p>
                  </div>
                </div>
                <p className="mb-3 text-sm text-ink-muted">
                  {recipe.ingredients
                    .slice(0, 5)
                    .map((ri) => `${ri.ingredient.name} ${ri.quantity}${UNIT_LABELS[ri.unit] ?? ri.unit}`)
                    .join(", ")}
                </p>
                {editable ? (
                  <details className="rounded-lg border border-line bg-surface-2 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-ink">Recept bewerken</summary>
                  <form action={updateRecipeDetails} className="mt-3 grid gap-2">
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
                    <PendingSubmitButton pendingText="Opslaan..." className="w-fit rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-muted hover:border-accent hover:text-accent">
                      Recept opslaan
                    </PendingSubmitButton>
                  </form>
                  <form action={deleteRecipe} className="mt-3 border-t border-line pt-3">
                    <input type="hidden" name="householdId" value={household.id} />
                    <input type="hidden" name="recipeId" value={recipe.id} />
                    <PendingSubmitButton pendingText="Verwijderen..." className="w-fit rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-600 hover:border-red-300 hover:bg-red-50">
                      Recept verwijderen
                    </PendingSubmitButton>
                  </form>
                  </details>
                ) : (
                  <form action={copyRecipeToHousehold}>
                    <input type="hidden" name="householdId" value={household.id} />
                    <input type="hidden" name="recipeId" value={recipe.id} />
                    <PendingSubmitButton pendingText="Kopiëren..." className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-muted hover:border-accent hover:text-accent">
                      Maak eigen kopie
                    </PendingSubmitButton>
                  </form>
                )}

                {editable && (
                  <details className="mt-3 rounded-lg border border-line bg-surface-2 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-ink">Ingrediënten aanpassen</summary>
                    <form action={updateRecipeIngredients} className="mt-3 grid gap-2">
                      <input type="hidden" name="householdId" value={household.id} />
                      <input type="hidden" name="recipeId" value={recipe.id} />
                      <IngredientRows
                        ingredients={ingredients}
                        recipeIngredients={recipe.ingredients.map((ri) => ({ ingredientId: ri.ingredientId, quantity: ri.quantity }))}
                        minRows={recipe.ingredients.length}
                      />
                      <PendingSubmitButton pendingText="Opslaan..." className="w-fit rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-muted hover:border-accent hover:text-accent">
                        Ingrediënten opslaan
                      </PendingSubmitButton>
                    </form>
                  </details>
                )}

                {editable && <details className="mt-3 rounded-lg border border-line bg-surface-2 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-ink">Varianten aanpassen</summary>
                  <div className="mt-3 grid gap-3">
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
                      <PendingSubmitButton pendingText="Opslaan..." className="w-fit rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-muted hover:border-accent hover:text-accent">
                        Variant opslaan
                      </PendingSubmitButton>
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
                      <PendingSubmitButton pendingText="Toevoegen..." className="w-fit rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-ink">
                        Variant toevoegen
                      </PendingSubmitButton>
                    </form>
                  </details>
                  </div>
                </details>}
              </article>
            );
          })}
        </div>
      </div>

      <NavBar />
    </div>
  );
}
