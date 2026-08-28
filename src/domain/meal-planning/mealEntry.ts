import type { Unit } from "@/generated/prisma/enums";

/**
 * Eén avond in de weekplanning kan sinds de samengestelde maaltijden twee
 * vormen hebben: een recept, of een samenstelling uit componenten (aardappel
 * + vlees + groente). Deze module is de enige plek die dat onderscheid kent.
 *
 * Waarom één plek: er zijn ruim tien plaatsen die "wat eten we die avond" en
 * "welke ingrediënten horen daarbij" willen weten — pagina's, de
 * boodschappenlijst, de tekortcontrole. Zouden die het elk zelf uitrekenen,
 * dan is het een kwestie van tijd voordat er één de componenten vergeet en
 * stilzwijgend een lege avond toont of te weinig boodschappen bestelt.
 *
 * Bewust structurele types (geen Prisma-payloadtypes): zo is dit met simpele
 * literals te testen, en hoeft een aanroeper alleen te selecteren wat hij
 * echt nodig heeft.
 */

export interface MealEntryIngredient {
  ingredientId: string;
  quantity: number;
  unit: Unit;
}

export interface MealEntryComponentLike {
  option: {
    name: string;
    ingredientId: string;
    quantityPerPortion: number;
    unit: Unit;
    group: { role: string; sortOrder: number };
  };
}

/**
 * Eén deel van een avond waarop niet iedereen hetzelfde eet.
 * `fulfillment` bepaalt of er boodschappen uit voortkomen: een deel dat
 * iemand zelf regelt levert niets op, maar sluit de avond niet uit.
 */
export interface MealAssignmentLike {
  label: string;
  fulfillment: string;
  sortOrder: number;
  persons: { personId: string }[];
  items: { ingredientId: string; quantityPerPortion: number; unit: Unit }[];
}

export interface MealEntryLike {
  recipeVariant: { recipe: { title: string; ingredients: MealEntryIngredient[] } } | null;
  mealTemplate: { name: string } | null;
  components: MealEntryComponentLike[];
  /** Leeg in het normale geval: iedereen eet dan hetzelfde. */
  assignments?: MealAssignmentLike[];
}

/** Hoeveel porties er van een deel nodig zijn: alleen de aanwezige personen tellen. */
function assignmentPortions(
  assignment: MealAssignmentLike,
  personPortions: Map<string, number> | undefined
): number {
  if (!personPortions) return assignment.persons.length;
  return assignment.persons.reduce((sum, person) => sum + (personPortions.get(person.personId) ?? 0), 0);
}

/** Componenten in de volgorde waarin ze in de naam terechtkomen. */
function sortedComponents(entry: MealEntryLike) {
  return [...entry.components].sort(
    (a, b) => a.option.group.sortOrder - b.option.group.sortOrder || a.option.name.localeCompare(b.option.name)
  );
}

/**
 * De naam van de maaltijd zoals de gebruiker hem ziet.
 *
 * Voor een samenstelling wordt dat "Schnitzel met aardappelblokjes en
 * broccoli": het eiwitcomponent voorop (daar noem je zo'n avond naar), de
 * rest erachter. Zonder componenten valt hij terug op de naam van het
 * sjabloon — eerlijker dan een lege regel, en zichtbaar anders dan een echt
 * gerecht.
 */
export function mealEntryTitle(entry: MealEntryLike): string {
  const assignments = entry.assignments ?? [];
  if (assignments.length > 0) {
    // Een verdeelde avond heeft geen één naam; hem toch verzinnen zou
    // verbergen dat er twee dingen op tafel staan.
    return [...assignments]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
      .map((assignment) => assignment.label)
      .join(" · ");
  }
  if (entry.recipeVariant) return entry.recipeVariant.recipe.title;

  const components = sortedComponents(entry);
  if (components.length === 0) return entry.mealTemplate?.name ?? "Nog geen maaltijd gekozen";

  const protein = components.find((component) => component.option.group.role === "PROTEIN");
  const rest = components.filter((component) => component !== protein).map((component) => component.option.name);
  const head = protein?.option.name ?? rest.shift() ?? "";
  if (rest.length === 0) return head;

  const tail =
    rest.length === 1 ? rest[0] : `${rest.slice(0, -1).join(", ")} en ${rest[rest.length - 1]}`;
  return `${head} met ${tail.toLowerCase()}`;
}

/** Is dit een samengestelde maaltijd in plaats van een recept? */
export function isCompositeMealEntry(entry: MealEntryLike): boolean {
  return !entry.recipeVariant && entry.components.length > 0;
}

/**
 * Wat er voor deze avond gekocht moet worden, opgeteld per ingrediënt.
 *
 * De twee vormen rekenen bewust verschillend, omdat ze verschillend zijn
 * opgeschreven:
 * - **Recept**: de hoeveelheden gelden voor het hele gezin zoals het normaal
 *   aan tafel zit, dus die worden geschaald met `scale` (aanwezige porties
 *   gedeeld door de gebruikelijke porties).
 * - **Component**: de hoeveelheid staat per persoon (één schnitzel, 200 gram
 *   aardappel), dus die wordt vermenigvuldigd met het aantal porties dat er
 *   die avond daadwerkelijk aan tafel zit.
 *
 * Hetzelfde ingrediënt uit twee componenten wordt één regel — anders zou
 * "aardappel" twee keer op de boodschappenlijst komen.
 */
export function mealEntryNeeds(
  entry: MealEntryLike,
  portions: {
    scale: number;
    presentPortions: number;
    /**
     * Porties per aanwezige persoon. Alleen nodig voor een verdeelde avond:
     * daar hangt de hoeveelheid af van wie er bij welk deel hoort. Ontbreekt
     * hij, dan telt elk toegewezen persoon voor één portie.
     */
    personPortions?: Map<string, number>;
  }
): MealEntryIngredient[] {
  const totals = new Map<string, MealEntryIngredient>();

  const add = (ingredientId: string, quantity: number, unit: Unit) => {
    const key = `${ingredientId}:${unit}`;
    const current = totals.get(key);
    if (current) current.quantity += quantity;
    else totals.set(key, { ingredientId, quantity, unit });
  };

  const assignments = entry.assignments ?? [];
  if (assignments.length > 0) {
    for (const assignment of assignments) {
      // "Zelf regelen" levert geen boodschappen op — maar laat de rest van de
      // avond wél gewoon staan. Dat is precies waarom een verdeelde avond
      // bestaat.
      if (assignment.fulfillment === "SELF_PROVIDED") continue;
      const assignmentPortionCount = assignmentPortions(assignment, portions.personPortions);
      if (assignmentPortionCount <= 0) continue;
      for (const item of assignment.items) {
        add(item.ingredientId, item.quantityPerPortion * assignmentPortionCount, item.unit);
      }
    }
    return [...totals.values()];
  }

  if (entry.recipeVariant) {
    for (const ingredient of entry.recipeVariant.recipe.ingredients) {
      add(ingredient.ingredientId, ingredient.quantity * portions.scale, ingredient.unit);
    }
    return [...totals.values()];
  }

  for (const component of entry.components) {
    add(
      component.option.ingredientId,
      component.option.quantityPerPortion * portions.presentPortions,
      component.option.unit
    );
  }
  return [...totals.values()];
}
