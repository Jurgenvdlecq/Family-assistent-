/**
 * Integratietest tegen een echte (lokale) Postgres: welke producten mag de
 * boodschappenlijst überhaupt kiezen?
 *
 * Sinds de prijslaag staan de producten van Albert Heijn en Dirk in dezelfde
 * `Product`-tabel als die van Picnic. Ze zijn er om mee te vergelijken —
 * bestellen gaat en blijft via Picnic. Deze test legt vast dat de matcher ze
 * daarom nooit op een boodschappenregel zet, want zo'n regel heeft geen
 * Picnic-id: hij zou stilzwijgend niet meegaan naar het mandje, en het juiste
 * product hebben verdrongen.
 *
 * Een echte database is hier het punt: het gaat om de query die de kandidaten
 * ophaalt, en dat is precies wat een gemockte Prisma-laag zou wegpoetsen.
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { ensureShoppingList } from "./shoppingList";
import { getCurrentWeekStart } from "./week";

async function makeFixture(label: string) {
  const household = await prisma.household.create({
    data: { name: label, persons: { create: [{ name: "Test", role: "PARENT" }] } },
  });
  const ingredient = await prisma.ingredient.create({
    data: { name: `${label} ingrediënt ${household.id}`, unit: "PIECE", category: "OTHER" },
  });
  const recipe = await prisma.recipe.create({
    data: {
      title: `${label} gerecht ${household.id}`,
      category: "OTHER",
      ingredients: { create: [{ ingredientId: ingredient.id, quantity: 1, unit: "PIECE" }] },
      variants: { create: [{ variantType: "FAST" }] },
    },
    include: { variants: true },
  });
  const mealPlan = await prisma.mealPlan.create({
    data: {
      householdId: household.id,
      weekStart: getCurrentWeekStart(),
      status: "CONFIRMED",
      entries: {
        create: [
          { dayOfWeek: "MONDAY", recipeVariantId: recipe.variants[0].id, includedInGroceries: true },
        ],
      },
    },
  });
  return { household, ingredient, mealPlan };
}

async function cleanup(householdId: string) {
  await prisma.shoppingList.deleteMany({ where: { mealPlan: { householdId } } });
  await prisma.mealPlan.deleteMany({ where: { householdId } });
  await prisma.product.deleteMany({ where: { externalRef: { contains: householdId } } });
  await prisma.recipe.deleteMany({ where: { title: { contains: householdId } } });
  await prisma.ingredient.deleteMany({ where: { name: { contains: householdId } } });
  await prisma.person.deleteMany({ where: { householdId } });
  await prisma.household.delete({ where: { id: householdId } });
}

test("boodschappenlijst: een winkelproduct van Albert Heijn komt nooit op een regel", async () => {
  const { household, ingredient, mealPlan } = await makeFixture("Winkelproduct");
  try {
    // Alleen een AH-product voor dit ingrediënt — verder niets. Vóór de
    // afbakening koos de matcher dit gewoon, en dan stond er een regel op de
    // lijst die nooit besteld kan worden.
    await prisma.product.create({
      data: {
        name: "AH Testproduct",
        provider: "AH",
        externalRef: `ah-test-${household.id}`,
        ingredientId: ingredient.id,
        lastSeenAvailable: new Date(),
      },
    });

    const list = await ensureShoppingList(mealPlan.id, household.id);
    const line = list.lines.find((candidate) => candidate.ingredientId === ingredient.id);
    assert.ok(line, "de regel hoort er gewoon te staan");
    assert.equal(line.productId, null, "maar zonder product — een AH-artikel gaat niet naar Picnic");
  } finally {
    await cleanup(household.id);
  }
});

test("boodschappenlijst: naast een AH-product wint het Picnic-product", async () => {
  const { household, ingredient, mealPlan } = await makeFixture("Twee winkels");
  try {
    const picnicProduct = await prisma.product.create({
      data: {
        name: "Picnic Testproduct",
        provider: "PICNIC",
        externalRef: `picnic-test-${household.id}`,
        ingredientId: ingredient.id,
        lastSeenAvailable: new Date(),
      },
    });
    // Goedkoper, en toch niet de winnaar: bij Albert Heijn bestellen kan de
    // app niet, dus "goedkoper" is hier geen argument maar een valstrik.
    await prisma.product.create({
      data: {
        name: "AH Testproduct",
        provider: "AH",
        externalRef: `ah-test-${household.id}`,
        ingredientId: ingredient.id,
        price: 0.01,
        lastSeenAvailable: new Date(),
      },
    });

    const list = await ensureShoppingList(mealPlan.id, household.id);
    const line = list.lines.find((candidate) => candidate.ingredientId === ingredient.id);
    assert.equal(line?.productId, picnicProduct.id);
  } finally {
    await cleanup(household.id);
  }
});
