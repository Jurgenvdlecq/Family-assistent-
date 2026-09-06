import { prisma } from "./prisma";
import { contentWords } from "@/domain/pricing/storeMatch";
import { dishIndex, findDish } from "./dishLookup";
import { accessibleRecipeWhere } from "./recipeScope";

/**
 * Een regel uit het snelle lijstje die geen product blijkt te zijn maar een
 * gerecht dat de app kent.
 */
export interface DishSuggestion {
  raw: string;
  dishTitle: string;
  /** De ingrediënten die in het lijstje komen als je het aanbod aanneemt. */
  ingredientNames: string[];
  /** Overgeslagen omdat het voorraadbasics zijn (olie, bouillon, ...). */
  skippedNames: string[];
}

export interface DishLookupLine {
  raw: string;
  searchTerm: string;
}

/**
 * De gerechten opzoeken die bij de regels van dit lijstje horen.
 *
 * Twee zoekopdrachten: eerst alleen de titels (om te weten óf er een gerecht
 * bij zit), dan de ingrediënten van alleen wat er werkelijk uitkwam. Beide
 * afgeschermd met `accessibleRecipeWhere` — een huishouden hoort de gerechten
 * van een ander huishouden niet te zien, ook niet als bijvangst van een
 * boodschappenlijstje.
 *
 * Voorraadbasics blijven eruit. Wie "pasta pesto" zegt bedoelt niet dat er
 * elke keer opnieuw olijfolie, zout en peper besteld moet worden — en wat er
 * is overgeslagen krijgt de gebruiker te zien, zodat het een keuze blijft en
 * geen stilte.
 */
export async function findDishesForLines(
  householdId: string,
  lines: DishLookupLine[]
): Promise<Map<string, DishSuggestion>> {
  const found = new Map<string, DishSuggestion>();
  if (lines.length === 0) return found;

  // Alleen titels die élk woord van een regel bevatten. Dat is precies de
  // voorwaarde die `findDish` daarna scherper nog een keer stelt, dus er kan
  // hier niets wegvallen dat anders herkend zou zijn.
  //
  // Bewust géén "haal de eerste zoveel titels op en zoek daarin": de
  // receptencatalogus is gedeeld en groeit, en dan zou een gerecht op een dag
  // stilzwijgend niet meer herkend worden omdat het buiten die grens viel —
  // precies het soort fout dat pas opvalt als iemand zich afvraagt waarom het
  // vroeger wél werkte.
  const titleFilters = lines
    .map((line) => contentWords(line.searchTerm))
    .filter((words) => words.length > 0)
    .map((words) => ({ AND: words.map((word) => ({ title: { contains: word, mode: "insensitive" as const } })) }));
  if (titleFilters.length === 0) return found;

  const titles = await prisma.recipe.findMany({
    where: { AND: [accessibleRecipeWhere(householdId), { OR: titleFilters }] },
    select: { id: true, title: true },
  });
  const index = dishIndex(titles);

  const matches = new Map<string, { raw: string; title: string }>();
  for (const line of lines) {
    const dish = findDish(line.searchTerm, index);
    if (dish && !matches.has(dish.id)) matches.set(dish.id, { raw: line.raw, title: dish.title });
  }
  if (matches.size === 0) return found;

  const recipes = await prisma.recipe.findMany({
    where: { id: { in: [...matches.keys()] }, ...accessibleRecipeWhere(householdId) },
    select: {
      id: true,
      ingredients: { select: { ingredient: { select: { name: true, likelyInStock: true } } } },
    },
  });

  for (const recipe of recipes) {
    const match = matches.get(recipe.id);
    if (!match) continue;
    const ingredientNames = recipe.ingredients
      .filter((row) => !row.ingredient.likelyInStock)
      .map((row) => row.ingredient.name);
    // Een gerecht zonder ingrediënten om aan te bieden levert een knop op die
    // niets doet — dan liever helemaal geen aanbod.
    if (ingredientNames.length === 0) continue;
    found.set(match.raw, {
      raw: match.raw,
      dishTitle: match.title,
      ingredientNames,
      skippedNames: recipe.ingredients
        .filter((row) => row.ingredient.likelyInStock)
        .map((row) => row.ingredient.name),
    });
  }

  return found;
}
