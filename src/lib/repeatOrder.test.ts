/**
 * Integratietest tegen een echte (lokale) Postgres via DATABASE_URL.
 *
 * `getPreviousOrderSummary` bepaalt of de knop "Herhaal je vorige bestelling"
 * überhaupt getoond wordt. Een knop aanbieden die niets te herhalen heeft is
 * precies het soort schijnfunctionaliteit dat dit project niet wil, dus de
 * regel "alleen als er écht besteld is" ligt hier vast.
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { getPreviousOrderSummary, previousWeekStart } from "@/lib/repeatOrder";

async function makeHousehold(name: string) {
  return prisma.household.create({ data: { name, persons: { create: [{ name: "Test", role: "PARENT" }] } } });
}

async function cleanup(householdId: string) {
  await prisma.shoppingList.deleteMany({ where: { mealPlan: { householdId } } });
  await prisma.mealPlan.deleteMany({ where: { householdId } });
  await prisma.person.deleteMany({ where: { householdId } });
  await prisma.household.delete({ where: { id: householdId } });
}

/** Een vorige week met een lijst; `transferred` bepaalt of er ook echt besteld is. */
async function makePreviousWeek(householdId: string, transferred: boolean) {
  const variant = await prisma.recipeVariant.findFirstOrThrow({});
  const ingredient = await prisma.ingredient.findFirstOrThrow({});
  const mealPlan = await prisma.mealPlan.create({
    data: {
      householdId,
      weekStart: previousWeekStart(),
      entries: {
        create: [
          { dayOfWeek: "MONDAY", recipeVariantId: variant.id, includedInGroceries: true },
          { dayOfWeek: "TUESDAY", recipeVariantId: variant.id, includedInGroceries: false },
        ],
      },
    },
  });
  await prisma.shoppingList.create({
    data: {
      mealPlanId: mealPlan.id,
      lines: {
        create: [
          {
            ingredientId: ingredient.id,
            quantity: 1,
            unit: "PIECE",
            source: "MANUAL",
            matchStatus: "MATCHED_TRUSTED",
            matchConfidence: 1,
            transferredToPicnicAt: transferred ? new Date() : null,
          },
        ],
      },
    },
  });
}

test("getPreviousOrderSummary: zonder vorige week valt er niets te herhalen", async () => {
  const household = await makeHousehold("Herhalen — geen vorige week");
  try {
    assert.equal(await getPreviousOrderSummary(household.id), null);
  } finally {
    await cleanup(household.id);
  }
});

test("getPreviousOrderSummary: een vorige week zonder échte bestelling telt niet", async () => {
  // Een lijst die nooit naar Picnic is gegaan is geen bestelling — de knop
  // zou dan iets beloven wat er nooit was.
  const household = await makeHousehold("Herhalen — niet besteld");
  try {
    await makePreviousWeek(household.id, false);
    assert.equal(await getPreviousOrderSummary(household.id), null);
  } finally {
    await cleanup(household.id);
  }
});

test("getPreviousOrderSummary: telt de losse producten en de kookavonden van de vorige bestelling", async () => {
  const household = await makeHousehold("Herhalen — wel besteld");
  try {
    await makePreviousWeek(household.id, true);
    const summary = await getPreviousOrderSummary(household.id);
    assert.deepEqual(summary, { extraCount: 1, cookingDayCount: 1 }, "alleen de aangevinkte maandag telt als kookavond");
  } finally {
    await cleanup(household.id);
  }
});
