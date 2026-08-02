"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { assertCurrentHousehold } from "@/lib/auth";
import { parsePackageQuantity } from "@/lib/quantity/parsePackageSize";
import { accessibleRecipeWhere, editableRecipeWhere } from "@/lib/recipeScope";
import { recordProductChosen, recordProductRejected } from "@/domain/product-matching/repository";
import { parseRecipeIngredientText } from "@/lib/recipeIngredientText";
import { translateIngredientTextToDutch } from "@/lib/ingredientTranslation";
import { assertPubliclyReachableUrl, extractRecipeFromHtml, fetchRecipePageHtml } from "@/lib/recipeImport";
import { PicnicClient } from "@/lib/picnic/client";
import { picnicPriceToEuros, picnicProductRef } from "@/lib/picnic/products";

const RECIPE_CATEGORIES = [
  "PASTA",
  "WRAPS",
  "RICE_DISH",
  "ALL_VEGGIE_DAY",
  "QUICK_AND_EASY",
  "COMFORT_FOOD",
  "AIRFRYER",
  "OTHER",
] as const;
const RECIPE_STATUSES = ["FOUND", "ADAPTED", "PROVEN", "SAFE_CHOICE"] as const;
const VARIANT_TYPES = ["FAST", "FRESH", "REHEATABLE", "KID_FRIENDLY"] as const;
const INGREDIENT_CATEGORIES = ["MEAT", "FISH", "DAIRY", "VEGETABLE", "FRUIT", "GRAIN", "LEGUME", "PANTRY", "OTHER"] as const;
const UNITS = ["GRAM", "PIECE", "ML"] as const;

function parseEnum<T extends readonly string[]>(value: FormDataEntryValue | null, allowed: T, fallback: T[number]) {
  const raw = String(value ?? fallback);
  return allowed.includes(raw) ? (raw as T[number]) : fallback;
}

function parseList(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function requireRecipeEditor(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  return householdId;
}

async function assertEditableRecipe(householdId: string, recipeId: string) {
  const recipe = await prisma.recipe.findFirst({
    where: editableRecipeWhere(householdId, recipeId),
    select: { id: true },
  });
  if (!recipe) {
    throw new Error("Dit is een basisrecept. Maak eerst een eigen kopie voordat je het aanpast.");
  }
}

async function assertRecipeTitleAvailableForHousehold(householdId: string, title: string, exceptRecipeId?: string) {
  const existing = await prisma.recipe.findFirst({
    where: {
      householdId,
      title,
      ...(exceptRecipeId ? { NOT: { id: exceptRecipeId } } : {}),
    },
    select: { id: true },
  });
  if (existing) throw new Error("Er bestaat al een eigen recept met deze titel.");
}

async function pickAvailableRecipeTitle(householdId: string, title: string, suffixHint: string) {
  const existing = await prisma.recipe.findFirst({ where: { householdId, title }, select: { id: true } });
  if (!existing) return title;

  const alternative = `${title} (${suffixHint})`;
  const existingAlternative = await prisma.recipe.findFirst({
    where: { householdId, title: alternative },
    select: { id: true },
  });
  if (!existingAlternative) return alternative;

  throw new Error(`Er bestaat al een eigen recept met de titel "${title}".`);
}

async function invalidateCurrentShoppingList(householdId: string) {
  const { getCurrentWeekStart } = await import("@/lib/week");
  const weekStart = getCurrentWeekStart();
  const currentPlan = await prisma.mealPlan.findUnique({
    where: { householdId_weekStart: { householdId, weekStart } },
    select: { id: true },
  });
  if (!currentPlan) return;
  await prisma.shoppingList.deleteMany({ where: { mealPlanId: currentPlan.id } });
}

function revalidateRecipeManagementPaths() {
  revalidatePath("/recepten");
  revalidatePath("/");
  revalidatePath("/gerechten");
  revalidatePath("/boodschappen");
  revalidatePath("/controle");
}

/**
 * `revalidatePath` alleen is niet genoeg: zonder een echte navigatie bleef
 * deze pagina bij server-actions die niet redirecten soms de oude data
 * tonen (bijv. een net gekozen standaardproduct dat pas na een handmatige
 * herlaadactie zichtbaar werd — terwijl de wijziging allang goed was
 * opgeslagen). Een redirect terug naar dezelfde pagina dwingt een verse
 * render af én laat de gebruiker altijd expliciet zien dat het gelukt is.
 */
function redirectToRecipes(status: string): never {
  revalidateRecipeManagementPaths();
  redirect(`/recepten?status=${encodeURIComponent(status)}`);
}

async function parseRecipeIngredientRows(formData: FormData) {
  const rowCount = Number(formData.get("ingredientRowCount") ?? 0);
  const combined = new Map<string, number>();

  for (let index = 0; index < rowCount; index += 1) {
    const ingredientId = String(formData.get(`ingredientId-${index}`) ?? "");
    const quantityValue = formData.get(`quantity-${index}`);
    if (!ingredientId) continue;

    const quantity = Number(quantityValue);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("Vul bij elk gekozen ingrediënt een hoeveelheid groter dan 0 in.");
    }
    combined.set(ingredientId, (combined.get(ingredientId) ?? 0) + quantity);
  }

  const ingredientRows = Array.from(combined.entries()).map(([ingredientId, quantity]) => ({ ingredientId, quantity }));
  if (ingredientRows.length === 0) {
    throw new Error("Voeg minimaal één ingrediënt toe.");
  }

  const ingredients = await prisma.ingredient.findMany({
    where: { id: { in: ingredientRows.map((row) => row.ingredientId) } },
    select: { id: true, unit: true },
  });
  const unitByIngredientId = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient.unit]));
  if (ingredients.length !== ingredientRows.length) {
    throw new Error("Een gekozen ingrediënt bestaat niet meer.");
  }

  return ingredientRows.map((row) => ({
    ingredientId: row.ingredientId,
    quantity: row.quantity,
    unit: unitByIngredientId.get(row.ingredientId)!,
  }));
}

async function upsertParsedRecipeIngredients(lines: ReturnType<typeof parseRecipeIngredientText>) {
  const rows = [];
  for (const line of lines) {
    const ingredient = await prisma.ingredient.upsert({
      where: { name: line.name },
      update: {},
      create: {
        name: line.name,
        unit: line.unit,
        category: line.category,
      },
    });
    rows.push({
      ingredientId: ingredient.id,
      quantity: line.quantity,
      unit: ingredient.unit,
      ingredientName: ingredient.name,
    });
  }
  return rows;
}

async function savePicnicCandidatesForIngredients(householdId: string, rows: Awaited<ReturnType<typeof upsertParsedRecipeIngredients>>) {
  const household = await prisma.household.findUniqueOrThrow({
    where: { id: householdId },
    select: { picnicAuthToken: true },
  });
  if (!household.picnicAuthToken) return;

  const client = new PicnicClient(household.picnicAuthToken);
  try {
    for (const row of rows.slice(0, 12)) {
      const results = await client.search(row.ingredientName);
      const seenRefs = new Set<string>();
      const candidates = results
        .map((item) => {
          const externalRef = picnicProductRef(item);
          if (!externalRef || !item.name || seenRefs.has(externalRef)) return null;
          seenRefs.add(externalRef);
          const packageSize = item.unit_quantity ?? null;
          return {
            ingredientId: row.ingredientId,
            externalRef,
            picnicImageId: item.image_id ?? null,
            name: item.name,
            packageSize,
            packageQuantity: packageSize ? parsePackageQuantity(packageSize, row.unit) : null,
            price: picnicPriceToEuros(item.display_price ?? item.price),
            lastSeenAvailable: new Date(),
          };
        })
        .filter((item) => item !== null)
        .slice(0, 3);

      await Promise.all(
        candidates.map((candidate) =>
          prisma.product.upsert({
            where: {
              ingredientId_provider_externalRef: {
                ingredientId: candidate.ingredientId,
                provider: "PICNIC",
                externalRef: candidate.externalRef,
              },
            },
            update: candidate,
            create: candidate,
          })
        )
      );
    }
  } finally {
    const refreshedToken = client.getAuthToken();
    if (refreshedToken && refreshedToken !== household.picnicAuthToken) {
      await prisma.household.update({
        where: { id: householdId },
        data: { picnicAuthToken: refreshedToken, picnicTokenUpdatedAt: new Date() },
      });
    }
  }
}

export async function createQuickRecipe(formData: FormData) {
  const householdId = await requireRecipeEditor(formData);
  const title = String(formData.get("title") ?? "").trim();
  const ingredientText = String(formData.get("ingredientText") ?? "").trim();

  if (!title) throw new Error("Naam van het recept is verplicht.");
  if (!ingredientText) throw new Error("Vul de ingrediënten en hoeveelheden in.");

  await assertRecipeTitleAvailableForHousehold(householdId, title);

  const parsedLines = parseRecipeIngredientText(ingredientText);
  if (parsedLines.length === 0) {
    throw new Error("Ik kon geen ingrediënten herkennen. Gebruik bijvoorbeeld: 400g kipfilet, 300g rijst, 2 paprika.");
  }

  const ingredientRows = await upsertParsedRecipeIngredients(parsedLines);

  await prisma.recipe.create({
    data: {
      title,
      category: "OTHER",
      status: "FOUND",
      scope: "HOUSEHOLD",
      householdId,
      originHouseholdId: householdId,
      source: "Snel toegevoegd",
      ingredients: {
        create: ingredientRows.map((row) => ({
          ingredientId: row.ingredientId,
          quantity: row.quantity,
          unit: row.unit,
        })),
      },
      variants: {
        create: {
          variantType: "FRESH",
          contextFit: [],
        },
      },
    },
  });

  await savePicnicCandidatesForIngredients(householdId, ingredientRows);
  await invalidateCurrentShoppingList(householdId);
  redirectToRecipes("recipe-created");
}

/**
 * Vertaalt een fout uit de import-stap naar een vaste statuscode i.p.v. de
 * ruwe foutmelding zelf door te geven — Next.js toont in productie bij een
 * `throw` uit een server-actie alleen een generieke "dat lukte niet"-tekst
 * (bewust, om te voorkomen dat interne details lekken), waardoor de eerder
 * zorgvuldig geschreven Nederlandse meldingen de gebruiker nooit bereikten.
 * Dezelfde vaste-statuscode-aanpak als de bestaande succesmeldingen op deze
 * pagina (en de twee foutmeldingen op `/ons-gezin`) — geen nieuwe patroon.
 */
function classifyImportError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Vul een link")) return "import-url-missing";
  if (message.includes("geen geldige link") || message.includes("http(s)-links")) return "import-url-invalid";
  if (message.includes("normale website")) return "import-url-blocked";
  if (
    message.includes("niet vinden op internet") ||
    message.includes("niet ophalen") ||
    message.includes("duurde te lang") ||
    message.includes("geen webpagina met een recept") ||
    message.includes("te groot om te importeren") ||
    message.includes("Te veel doorverwijzingen")
  ) {
    return "import-url-unreachable";
  }
  if (message.includes("niet automatisch herkennen")) return "import-no-recipe-found";
  if (message.includes("geen ingrediënten herkennen")) return "import-no-ingredients";
  if (message.includes("bestaat al een eigen recept")) return "import-duplicate-title";
  return "import-failed";
}

type ImportedRecipeData = {
  title: string;
  sourceUrl: string;
  instructions: string[];
  parsedLines: ReturnType<typeof parseRecipeIngredientText>;
};

/**
 * Doet het eigenlijke ophaal-/leeswerk en geeft een resultaat terug in
 * plaats van te gooien. Next.js schrijft voor dat `redirect()` altijd
 * buiten een `try/catch` aangeroepen wordt (het gooit zelf een interne
 * `NEXT_REDIRECT`-marker) — dus deze functie blijft binnen haar eigen
 * try/catch, en `importRecipeFromUrl` hieronder roept `redirectToRecipes`
 * pas aan ná deze functie, nooit vanuit een catch-blok.
 */
async function tryImportRecipeFromUrl(
  householdId: string,
  rawUrl: string
): Promise<{ ok: true; data: ImportedRecipeData } | { ok: false; errorCode: string }> {
  try {
    const url = await assertPubliclyReachableUrl(rawUrl);
    const html = await fetchRecipePageHtml(url);
    const extracted = extractRecipeFromHtml(html);

    if (!extracted) {
      throw new Error(
        'Kon dit recept niet automatisch herkennen op deze pagina. Plak de ingrediënten hieronder handmatig bij "Nieuw recept snel toevoegen".'
      );
    }

    const translatedIngredientLines = extracted.ingredientLines.map(translateIngredientTextToDutch);
    const parsedLines = parseRecipeIngredientText(translatedIngredientLines.join("\n"));
    if (parsedLines.length === 0) {
      throw new Error("Kon geen ingrediënten herkennen op deze pagina. Plak de tekst hieronder handmatig.");
    }

    const title = await pickAvailableRecipeTitle(householdId, extracted.title, url.hostname);
    return {
      ok: true,
      data: { title, sourceUrl: url.toString(), instructions: extracted.instructions, parsedLines },
    };
  } catch (error) {
    return { ok: false, errorCode: classifyImportError(error) };
  }
}

/**
 * Importeert één recept via een door de gebruiker aangewezen link. Leest
 * alleen de machineleesbare schema.org/Recipe-data die de meeste
 * receptensites al standaard meeleveren (zie `recipeImport.ts`) — geen
 * losse HTML-scraping, en geen hele site leegtrekken. Ingrediënten gaan
 * door dezelfde tekstparser als "snel toevoegen"; de gebruiker wordt na
 * import expliciet naar controle gestuurd, want machinaal geparste
 * hoeveelheden uit vrije (vaak Engelstalige) tekst zijn per definitie een
 * twijfelgeval.
 */
export async function importRecipeFromUrl(formData: FormData) {
  const householdId = await requireRecipeEditor(formData);
  const rawUrl = String(formData.get("url") ?? "").trim();
  if (!rawUrl) redirectToRecipes("import-url-missing");

  const imported = await tryImportRecipeFromUrl(householdId, rawUrl);
  if (!imported.ok) {
    redirectToRecipes(imported.errorCode);
  }

  const { title, sourceUrl, instructions, parsedLines } = imported.data;
  const ingredientRows = await upsertParsedRecipeIngredients(parsedLines);

  await prisma.recipe.create({
    data: {
      title,
      category: "OTHER",
      status: "FOUND",
      scope: "HOUSEHOLD",
      householdId,
      originHouseholdId: householdId,
      source: sourceUrl,
      instructions,
      ingredients: {
        create: ingredientRows.map((row) => ({
          ingredientId: row.ingredientId,
          quantity: row.quantity,
          unit: row.unit,
        })),
      },
      variants: {
        create: {
          variantType: "FRESH",
          contextFit: [],
        },
      },
    },
  });

  await savePicnicCandidatesForIngredients(householdId, ingredientRows);
  await invalidateCurrentShoppingList(householdId);
  redirectToRecipes("recipe-imported");
}

export async function createRecipe(formData: FormData) {
  const householdId = await requireRecipeEditor(formData);
  const title = String(formData.get("title") ?? "").trim();
  const category = parseEnum(formData.get("category"), RECIPE_CATEGORIES, "OTHER");
  const variantType = parseEnum(formData.get("variantType"), VARIANT_TYPES, "FRESH");
  const source = String(formData.get("source") ?? "").trim() || null;
  const properties = parseList(formData.get("properties"));
  const instructions = parseList(formData.get("instructions"));
  const contextFit = parseList(formData.get("contextFit"));

  if (!title) throw new Error("Titel is verplicht.");

  await assertRecipeTitleAvailableForHousehold(householdId, title);

  const ingredientRows = await parseRecipeIngredientRows(formData);

  await prisma.recipe.create({
    data: {
      title,
      category,
      source,
      properties,
      instructions,
      status: "FOUND",
      scope: "HOUSEHOLD",
      householdId,
      originHouseholdId: householdId,
      ingredients: {
        create: ingredientRows.map((row) => ({
          ingredientId: row.ingredientId,
          quantity: row.quantity,
          unit: row.unit,
        })),
      },
      variants: {
        create: {
          variantType,
          contextFit,
        },
      },
    },
  });

  redirectToRecipes("recipe-created");
}

export async function updateRecipeDetails(formData: FormData) {
  const householdId = await requireRecipeEditor(formData);
  const recipeId = String(formData.get("recipeId"));
  const title = String(formData.get("title") ?? "").trim();
  const source = String(formData.get("source") ?? "").trim() || null;
  const category = parseEnum(formData.get("category"), RECIPE_CATEGORIES, "OTHER");
  const status = parseEnum(formData.get("status"), RECIPE_STATUSES, "FOUND");
  const properties = parseList(formData.get("properties"));
  const instructions = parseList(formData.get("instructions"));

  if (!title) throw new Error("Titel is verplicht.");

  await assertEditableRecipe(householdId, recipeId);
  await assertRecipeTitleAvailableForHousehold(householdId, title, recipeId);

  await prisma.recipe.update({
    where: { id: recipeId },
    data: { title, source, category, status, properties, instructions },
  });

  redirectToRecipes("recipe-updated");
}

/**
 * Alleen eigen huishoudrecepten kunnen verwijderd worden (nooit een
 * basisrecept — dat is gedeelde referentiedata). Blokkeert stilzwijgend
 * niets: een recept dat deze week nog op het menu staat of als vaste
 * daggewoonte is ingesteld, moet je daar eerst weghalen — anders zou de
 * huidige weekplanning of een toekomstige gewoonte zonder waarschuwing
 * verweesd raken.
 */
export async function deleteRecipe(formData: FormData) {
  const householdId = await requireRecipeEditor(formData);
  const recipeId = String(formData.get("recipeId"));

  await assertEditableRecipe(householdId, recipeId);

  const recipe = await prisma.recipe.findUniqueOrThrow({
    where: { id: recipeId },
    include: { variants: { select: { id: true } } },
  });
  const variantIds = recipe.variants.map((v) => v.id);

  const { getCurrentWeekStart } = await import("@/lib/week");
  const weekStart = getCurrentWeekStart();
  const currentMealPlan = await prisma.mealPlan.findUnique({
    where: { householdId_weekStart: { householdId, weekStart } },
    select: { id: true },
  });

  const [usedInCurrentWeek, usedAsRoutine] = await Promise.all([
    currentMealPlan
      ? prisma.mealPlanEntry.count({
          where: { mealPlanId: currentMealPlan.id, recipeVariantId: { in: variantIds } },
        })
      : Promise.resolve(0),
    prisma.dayRoutine.count({ where: { householdId, recipeVariantId: { in: variantIds } } }),
  ]);

  if (usedInCurrentWeek > 0) {
    throw new Error("Dit recept staat deze week nog op het menu. Vervang het eerst via 'Ander gerecht' voordat je het verwijdert.");
  }
  if (usedAsRoutine > 0) {
    throw new Error("Dit recept is ingesteld als vaste daggewoonte. Stop die gewoonte eerst op 'Jouw week' voordat je het recept verwijdert.");
  }

  await prisma.$transaction([
    prisma.mealPlanEntry.deleteMany({ where: { recipeVariantId: { in: variantIds } } }),
    prisma.mealSuggestion.deleteMany({ where: { recipeVariantId: { in: variantIds } } }),
    prisma.recipe.delete({ where: { id: recipeId } }),
  ]);

  await invalidateCurrentShoppingList(householdId);
  redirectToRecipes("recipe-deleted");
}

export async function updateRecipeIngredients(formData: FormData) {
  const householdId = await requireRecipeEditor(formData);
  const recipeId = String(formData.get("recipeId"));
  const ingredientRows = await parseRecipeIngredientRows(formData);

  await assertEditableRecipe(householdId, recipeId);

  await prisma.$transaction([
    prisma.recipeIngredient.deleteMany({ where: { recipeId } }),
    prisma.recipeIngredient.createMany({
      data: ingredientRows.map((row) => ({ recipeId, ingredientId: row.ingredientId, quantity: row.quantity, unit: row.unit })),
    }),
  ]);

  await invalidateCurrentShoppingList(householdId);
  redirectToRecipes("ingredients-updated");
}

export async function updateRecipeVariant(formData: FormData) {
  const householdId = await requireRecipeEditor(formData);
  const variantId = String(formData.get("variantId"));
  const contextFit = parseList(formData.get("contextFit"));

  const variant = await prisma.recipeVariant.findUniqueOrThrow({
    where: { id: variantId },
    select: { recipeId: true },
  });
  await assertEditableRecipe(householdId, variant.recipeId);

  await prisma.recipeVariant.update({
    where: { id: variantId },
    data: { contextFit },
  });

  redirectToRecipes("variant-updated");
}

export async function createRecipeVariant(formData: FormData) {
  const householdId = await requireRecipeEditor(formData);
  const recipeId = String(formData.get("recipeId"));
  const variantType = parseEnum(formData.get("variantType"), VARIANT_TYPES, "FRESH");
  const contextFit = parseList(formData.get("contextFit"));

  await assertEditableRecipe(householdId, recipeId);

  const existing = await prisma.recipeVariant.findUnique({
    where: { recipeId_variantType: { recipeId, variantType } },
    select: { id: true },
  });
  if (existing) {
    throw new Error("Deze variant bestaat al voor dit recept.");
  }

  await prisma.recipeVariant.create({
    data: { recipeId, variantType, contextFit },
  });

  redirectToRecipes("variant-created");
}

export async function copyRecipeToHousehold(formData: FormData) {
  const householdId = await requireRecipeEditor(formData);
  const recipeId = String(formData.get("recipeId"));

  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, ...accessibleRecipeWhere(householdId), householdId: null },
    include: {
      ingredients: true,
      variants: true,
    },
  });
  if (!recipe) throw new Error("Dit basisrecept bestaat niet meer of is al van jullie.");

  await assertRecipeTitleAvailableForHousehold(householdId, recipe.title);

  await prisma.recipe.create({
    data: {
      title: recipe.title,
      category: recipe.category,
      source: recipe.source,
      imageUrl: recipe.imageUrl,
      imageSourceUrl: recipe.imageSourceUrl,
      imageAttribution: recipe.imageAttribution,
      properties: recipe.properties,
      instructions: recipe.instructions,
      status: "ADAPTED",
      scope: "HOUSEHOLD",
      householdId,
      originHouseholdId: householdId,
      ingredients: {
        create: recipe.ingredients.map((ingredient) => ({
          ingredientId: ingredient.ingredientId,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
        })),
      },
      variants: {
        create: recipe.variants.map((variant) => ({
          variantType: variant.variantType,
          contextFit: variant.contextFit,
          ingredientOverrides: variant.ingredientOverrides as Prisma.InputJsonValue,
        })),
      },
    },
  });

  await invalidateCurrentShoppingList(householdId);
  redirectToRecipes("recipe-copied");
}

export async function createIngredient(formData: FormData) {
  await requireRecipeEditor(formData);
  const name = String(formData.get("name") ?? "").trim();
  const unit = parseEnum(formData.get("unit"), UNITS, "GRAM");
  const category = parseEnum(formData.get("category"), INGREDIENT_CATEGORIES, "OTHER");
  const restrictionTags = parseList(formData.get("restrictionTags"));
  const likelyInStock = formData.get("likelyInStock") === "on";

  if (!name) throw new Error("Ingrediëntnaam is verplicht.");

  await prisma.ingredient.create({
    data: { name, unit, category, restrictionTags, likelyInStock },
  });

  redirectToRecipes("ingredient-created");
}

/**
 * `Ingredient` is een globale, tussen alle huishoudens gedeelde catalogus
 * (SYSTEM_AUDIT.md, bevinding 3) — er is geen `householdId` op dit model en
 * dat is bewust (zie DATAMODEL_AUDIT.md). `category` en `restrictionTags`
 * zijn de twee velden waarop harde dieet-/allergiefiltering daadwerkelijk
 * draait (zie `src/lib/dietaryRestrictions.ts`: `category` bepaalt de
 * vegetarisch/veganistisch-uitsluiting, `restrictionTags` de directe
 * allergie-/dieetmatch). Zonder een `householdId`-kolom op `Ingredient` kan
 * geen enkel huishouden hier op dit moment technisch onderscheiden worden
 * van een ander — dus mag ook geen enkel huishouden deze twee velden van
 * een al bestaand ingrediënt via deze algemene beheerpagina kunnen
 * wijzigen, zelfs niet zijn eigen (`name`/`likelyInStock` zijn niet
 * veiligheidskritiek en blijven wel gewoon aanpasbaar). Een verkeerde
 * wijziging zou stilzwijgend de allergiebescherming van een ánder
 * huishouden kunnen verzwakken. Correcties aan `category`/`restrictionTags`
 * van een bestaand ingrediënt lopen voortaan alleen nog via seeddata, een
 * migratie, of rechtstreeks databasebeheer — niet via een UI die elk
 * huishouden kan bereiken.
 */
export async function updateIngredient(formData: FormData) {
  const householdId = await requireRecipeEditor(formData);
  const ingredientId = String(formData.get("ingredientId"));
  const name = String(formData.get("name") ?? "").trim();
  const likelyInStock = formData.get("likelyInStock") === "on";

  if (!name) throw new Error("Ingrediëntnaam is verplicht.");

  const existing = await prisma.ingredient.findUnique({ where: { name }, select: { id: true } });
  if (existing && existing.id !== ingredientId) {
    throw new Error("Er bestaat al een ander ingrediënt met deze naam.");
  }

  await prisma.ingredient.update({
    where: { id: ingredientId },
    data: { name, likelyInStock },
  });

  await invalidateCurrentShoppingList(householdId);
  redirectToRecipes("ingredient-updated");
}

export async function createIngredientProduct(formData: FormData) {
  const householdId = await requireRecipeEditor(formData);
  const ingredientId = String(formData.get("ingredientId"));
  const name = String(formData.get("name") ?? "").trim();
  const brand = String(formData.get("brand") ?? "").trim() || null;
  const packageSize = String(formData.get("packageSize") ?? "").trim() || null;
  const externalRef = String(formData.get("externalRef") ?? "").trim() || null;
  const priceValue = String(formData.get("price") ?? "").trim();
  const setAsDefault = formData.get("setAsDefault") === "on";

  if (!name) throw new Error("Productnaam is verplicht.");

  const ingredient = await prisma.ingredient.findUniqueOrThrow({
    where: { id: ingredientId },
    select: { unit: true },
  });
  const price = priceValue ? Number(priceValue.replace(",", ".")) : null;
  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    throw new Error("Vul een geldige prijs in.");
  }

  const product = await prisma.product.create({
    data: {
      ingredientId,
      name,
      brand,
      packageSize,
      externalRef,
      price,
      packageQuantity: packageSize ? parsePackageQuantity(packageSize, ingredient.unit) : null,
      lastSeenAvailable: new Date(),
    },
  });

  if (setAsDefault) {
    await recordProductChosen(householdId, ingredientId, product.id, "MANUAL");
  }

  await invalidateCurrentShoppingList(householdId);
  redirectToRecipes("product-created");
}

export async function setDefaultProductForIngredient(formData: FormData) {
  const householdId = await requireRecipeEditor(formData);
  const ingredientId = String(formData.get("ingredientId"));
  const productId = String(formData.get("productId"));

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { ingredientId: true },
  });
  if (product.ingredientId !== ingredientId) {
    throw new Error("Dit product hoort niet bij dit ingrediënt.");
  }

  await prisma.rejectedProductMatch.deleteMany({ where: { householdId, ingredientId, productId } });
  await recordProductChosen(householdId, ingredientId, productId, "MANUAL");

  await invalidateCurrentShoppingList(householdId);
  redirectToRecipes("product-default");
}

export async function rejectProductForIngredient(formData: FormData) {
  const householdId = await requireRecipeEditor(formData);
  const ingredientId = String(formData.get("ingredientId"));
  const productId = String(formData.get("productId"));

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { ingredientId: true },
  });
  if (product.ingredientId !== ingredientId) {
    throw new Error("Dit product hoort niet bij dit ingrediënt.");
  }

  await recordProductRejected(householdId, ingredientId, productId, "ingredient_management");
  await prisma.householdProductPreference.deleteMany({ where: { householdId, ingredientId, productId } });

  await invalidateCurrentShoppingList(householdId);
  redirectToRecipes("product-rejected");
}

export async function allowProductForIngredient(formData: FormData) {
  const householdId = await requireRecipeEditor(formData);
  const ingredientId = String(formData.get("ingredientId"));
  const productId = String(formData.get("productId"));

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { ingredientId: true },
  });
  if (product.ingredientId !== ingredientId) {
    throw new Error("Dit product hoort niet bij dit ingrediënt.");
  }

  await prisma.rejectedProductMatch.deleteMany({ where: { householdId, ingredientId, productId } });

  await invalidateCurrentShoppingList(householdId);
  redirectToRecipes("product-allowed");
}
