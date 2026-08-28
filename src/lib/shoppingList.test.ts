import { test } from "node:test";
import assert from "node:assert/strict";
import { describeLinePackaging, findShoppingListShortfalls, isUserChosenPackageCount } from "./shoppingList";

const NO_INVENTORY = new Map();

// Iedereen eet mee, ongeacht de datum — de datumafhankelijke schaling zelf
// wordt getest in presence.test.ts en household.test.ts.
const NORMAL_SCALE = () => ({
  scale: 1,
  presentPortions: 1,
  defaultPortions: 1,
  presentPersonNames: [],
});

// Maandag 7 september 2026 (ISO-week 37, oneven).
const DATE_BY_DAY = {
  MONDAY: new Date(2026, 8, 7),
  TUESDAY: new Date(2026, 8, 8),
  WEDNESDAY: new Date(2026, 8, 9),
} as const;

function mealPlanWithNeed(
  entries: Array<{
    dayOfWeek: "MONDAY" | "TUESDAY" | "WEDNESDAY";
    ingredientId: string;
    quantity: number;
    unit: "GRAM" | "PIECE";
    skipped?: boolean;
    includedInGroceries?: boolean;
  }>
) {
  return {
    entries: entries.map((e) => ({
      dayOfWeek: e.dayOfWeek,
      date: DATE_BY_DAY[e.dayOfWeek],
      skipped: e.skipped ?? false,
      // Deze fixture beschrijft avonden die de gebruiker heeft aangevinkt;
      // niet-aangevinkte avonden zijn een expliciet testgeval hieronder.
      includedInGroceries: e.includedInGroceries ?? true,
      recipeVariant: {
        recipe: { title: "Testgerecht", ingredients: [{ ingredientId: e.ingredientId, quantity: e.quantity, unit: e.unit }] },
      },
      mealTemplate: null,
      components: [],
    })),
  };
}

function line(overrides: { id: string; ingredientId: string; quantity: number; unit: "GRAM" | "PIECE"; source?: string }) {
  return { source: "MEAL", ...overrides };
}

test("findShoppingListShortfalls: regel exact op benodigde hoeveelheid -> geen tekort", () => {
  const mealPlan = mealPlanWithNeed([{ dayOfWeek: "MONDAY", ingredientId: "aardappelen", quantity: 800, unit: "GRAM" }]);
  const lines = [line({ id: "l1", ingredientId: "aardappelen", quantity: 800, unit: "GRAM" })];
  const result = findShoppingListShortfalls(mealPlan, NORMAL_SCALE, NO_INVENTORY, lines);
  assert.deepEqual(result, []);
});

test("findShoppingListShortfalls: handmatig verlaagde regel -> tekort met juist verschil", () => {
  const mealPlan = mealPlanWithNeed([{ dayOfWeek: "MONDAY", ingredientId: "aardappelen", quantity: 800, unit: "GRAM" }]);
  const lines = [line({ id: "l1", ingredientId: "aardappelen", quantity: 750, unit: "GRAM" })];
  const result = findShoppingListShortfalls(mealPlan, NORMAL_SCALE, NO_INVENTORY, lines);
  assert.equal(result.length, 1);
  assert.equal(result[0].lineId, "l1");
  assert.equal(result[0].neededQuantity, 800);
  assert.equal(result[0].shortBy, 50);
});

test("findShoppingListShortfalls: regel met overschot is nooit een tekort", () => {
  const mealPlan = mealPlanWithNeed([{ dayOfWeek: "MONDAY", ingredientId: "aardappelen", quantity: 800, unit: "GRAM" }]);
  const lines = [line({ id: "l1", ingredientId: "aardappelen", quantity: 1500, unit: "GRAM" })];
  const result = findShoppingListShortfalls(mealPlan, NORMAL_SCALE, NO_INVENTORY, lines);
  assert.deepEqual(result, []);
});

test("findShoppingListShortfalls: telt behoefte van meerdere maaltijden dezelfde week bij elkaar op", () => {
  const mealPlan = mealPlanWithNeed([
    { dayOfWeek: "MONDAY", ingredientId: "kipfilet", quantity: 500, unit: "GRAM" },
    { dayOfWeek: "WEDNESDAY", ingredientId: "kipfilet", quantity: 400, unit: "GRAM" },
  ]);
  const lines = [line({ id: "l1", ingredientId: "kipfilet", quantity: 500, unit: "GRAM" })];
  const result = findShoppingListShortfalls(mealPlan, NORMAL_SCALE, NO_INVENTORY, lines);
  assert.equal(result.length, 1);
  assert.equal(result[0].neededQuantity, 900);
  assert.equal(result[0].shortBy, 400);
});

test("findShoppingListShortfalls: FIXED- en INVENTORY-regels worden nooit gecontroleerd", () => {
  const mealPlan = mealPlanWithNeed([{ dayOfWeek: "MONDAY", ingredientId: "melk", quantity: 1000, unit: "GRAM" }]);
  const lines = [
    line({ id: "l1", ingredientId: "melk", quantity: 0, unit: "GRAM", source: "FIXED" }),
    line({ id: "l2", ingredientId: "melk", quantity: 0, unit: "GRAM", source: "INVENTORY" }),
  ];
  const result = findShoppingListShortfalls(mealPlan, NORMAL_SCALE, NO_INVENTORY, lines);
  assert.deepEqual(result, []);
});

test("findShoppingListShortfalls: voorraad ('genoeg') verlaagt de echte behoefte, dus geen vals tekort", () => {
  const mealPlan = mealPlanWithNeed([{ dayOfWeek: "MONDAY", ingredientId: "rijst", quantity: 500, unit: "GRAM" }]);
  const inventory = new Map([["rijst", { status: "SUFFICIENT", quantity: null, unit: null }]]) as unknown as Parameters<
    typeof findShoppingListShortfalls
  >[2];
  const lines = [line({ id: "l1", ingredientId: "rijst", quantity: 0, unit: "GRAM" })];
  const result = findShoppingListShortfalls(mealPlan, NORMAL_SCALE, inventory, lines);
  assert.deepEqual(result, []);
});

test("findShoppingListShortfalls: ingrediënt dat deze week niet gebruikt wordt levert nooit een tekort op", () => {
  const mealPlan = mealPlanWithNeed([]);
  const lines = [line({ id: "l1", ingredientId: "kaas", quantity: 200, unit: "GRAM" })];
  const result = findShoppingListShortfalls(mealPlan, NORMAL_SCALE, NO_INVENTORY, lines);
  assert.deepEqual(result, []);
});

test("findShoppingListShortfalls: een overgeslagen dag (uit eten) telt niet mee in de behoefte", () => {
  const mealPlan = mealPlanWithNeed([
    { dayOfWeek: "MONDAY", ingredientId: "kipfilet", quantity: 500, unit: "GRAM" },
    { dayOfWeek: "WEDNESDAY", ingredientId: "kipfilet", quantity: 400, unit: "GRAM", skipped: true },
  ]);
  const lines = [line({ id: "l1", ingredientId: "kipfilet", quantity: 500, unit: "GRAM" })];
  const result = findShoppingListShortfalls(mealPlan, NORMAL_SCALE, NO_INVENTORY, lines);
  assert.deepEqual(result, [], "de 400g van de overgeslagen woensdag mag niet meetellen in de behoefte");
});

test("describeLinePackaging: verpakking bekend -> OK met aantal/totaal/overschot", () => {
  const result = describeLinePackaging({ quantity: 900, unit: "GRAM" }, { packageQuantity: 500 });
  assert.equal(result.status, "OK");
  assert.equal(result.packagesToBuy, 2);
  assert.equal(result.totalPurchased!.amount, 1000);
  assert.equal(result.expectedSurplus!.amount, 100);
});

test("describeLinePackaging: geen product -> PACKAGE_UNKNOWN", () => {
  const result = describeLinePackaging({ quantity: 400, unit: "GRAM" }, null);
  assert.equal(result.status, "PACKAGE_UNKNOWN");
});

test("describeLinePackaging: product zonder bekende packageQuantity -> PACKAGE_UNKNOWN", () => {
  const result = describeLinePackaging({ quantity: 400, unit: "GRAM" }, { packageQuantity: null });
  assert.equal(result.status, "PACKAGE_UNKNOWN");
});

test("describeLinePackaging: exact één verpakking -> geen overschot", () => {
  const result = describeLinePackaging({ quantity: 500, unit: "GRAM" }, { packageQuantity: 500 });
  assert.equal(result.status, "OK");
  assert.equal(result.packagesToBuy, 1);
  assert.equal(result.expectedSurplus!.amount, 0);
});

test("describeLinePackaging: stuksproducten werken hetzelfde", () => {
  const result = describeLinePackaging({ quantity: 7, unit: "PIECE" }, { packageQuantity: 6 });
  assert.equal(result.status, "OK");
  assert.equal(result.packagesToBuy, 2);
});

test("isUserChosenPackageCount: FIXED met unit PIECE -> true", () => {
  assert.equal(isUserChosenPackageCount({ source: "FIXED", unit: "PIECE" }), true);
});

test("isUserChosenPackageCount: MANUAL met unit PIECE -> true (WP82-regressie)", () => {
  assert.equal(isUserChosenPackageCount({ source: "MANUAL", unit: "PIECE" }), true);
});

test("isUserChosenPackageCount: MEAL met unit PIECE -> false, moet door de verpakkingsengine", () => {
  assert.equal(isUserChosenPackageCount({ source: "MEAL", unit: "PIECE" }), false);
});

test("isUserChosenPackageCount: FIXED/MANUAL met unit GRAM of ML -> false, dat is een letterlijke hoeveelheid, geen aantal", () => {
  assert.equal(isUserChosenPackageCount({ source: "FIXED", unit: "GRAM" }), false);
  assert.equal(isUserChosenPackageCount({ source: "MANUAL", unit: "ML" }), false);
});

test("findShoppingListShortfalls: een avond die niet is aangevinkt telt niet mee in de behoefte", () => {
  // Los van "uit eten": het gerecht staat gepland en het huishouden eet
  // gewoon thuis, maar deze avond gaat niet mee in déze bestelling.
  const mealPlan = mealPlanWithNeed([
    { dayOfWeek: "MONDAY", ingredientId: "aardappelen", quantity: 800, unit: "GRAM" },
    { dayOfWeek: "TUESDAY", ingredientId: "aardappelen", quantity: 800, unit: "GRAM", includedInGroceries: false },
  ]);
  const lines = [line({ id: "l1", ingredientId: "aardappelen", quantity: 800, unit: "GRAM" })];
  const result = findShoppingListShortfalls(mealPlan, NORMAL_SCALE, NO_INVENTORY, lines);
  assert.deepEqual(result, [], "alleen de aangevinkte maandag telt mee, dus 800 g is precies genoeg");
});

test("findShoppingListShortfalls: aangevinkt maar 'uit eten' telt evengoed niet mee", () => {
  // Beide vlaggen moeten kloppen; ze zijn bewust twee verschillende dingen.
  const mealPlan = mealPlanWithNeed([
    { dayOfWeek: "MONDAY", ingredientId: "aardappelen", quantity: 800, unit: "GRAM" },
    { dayOfWeek: "TUESDAY", ingredientId: "aardappelen", quantity: 800, unit: "GRAM", skipped: true },
  ]);
  const lines = [line({ id: "l1", ingredientId: "aardappelen", quantity: 800, unit: "GRAM" })];
  const result = findShoppingListShortfalls(mealPlan, NORMAL_SCALE, NO_INVENTORY, lines);
  assert.deepEqual(result, []);
});

test("findShoppingListShortfalls: de behoefte wordt geschaald op de datum van de avond, niet op de weekdag", () => {
  // De lijst van deze week kan avonden uit de volgende week bevatten
  // (bezorging zaterdag, koken dinsdag). Die twee weken hebben altijd een
  // verschillende oneven/even-pariteit, dus met "de schaal van dinsdag"
  // zou de helft van de boodschappen verkeerd uitvallen.
  const thisTuesday = new Date(2026, 8, 8);
  const nextTuesday = new Date(2026, 8, 15);
  const mealPlan = {
    entries: [
      {
        dayOfWeek: "TUESDAY" as const,
        date: thisTuesday,
        skipped: false,
        includedInGroceries: true,
        recipeVariant: {
          recipe: { title: "Testgerecht", ingredients: [{ ingredientId: "kip", quantity: 400, unit: "GRAM" as const }] },
        },
        mealTemplate: null,
        components: [],
      },
      {
        dayOfWeek: "TUESDAY" as const,
        date: nextTuesday,
        skipped: false,
        includedInGroceries: true,
        recipeVariant: {
          recipe: { title: "Testgerecht", ingredients: [{ ingredientId: "kip", quantity: 400, unit: "GRAM" as const }] },
        },
        mealTemplate: null,
        components: [],
      },
    ],
  };

  // Deze week eten er vier mee, volgende week twee.
  const scaleByDate = (date: Date) => ({
    scale: date.getTime() === nextTuesday.getTime() ? 0.5 : 1,
    presentPortions: 1,
    defaultPortions: 1,
    presentPersonNames: [],
  });

  const lines = [line({ id: "l1", ingredientId: "kip", quantity: 600, unit: "GRAM" })];
  const result = findShoppingListShortfalls(mealPlan, scaleByDate, NO_INVENTORY, lines);
  assert.deepEqual(result, [], "400 g + 200 g = 600 g, dus deze regel klopt precies");

  const tooLittle = [line({ id: "l1", ingredientId: "kip", quantity: 500, unit: "GRAM" })];
  const shortfall = findShoppingListShortfalls(mealPlan, scaleByDate, NO_INVENTORY, tooLittle);
  assert.equal(shortfall.length, 1);
  assert.equal(shortfall[0].neededQuantity, 600);
});
