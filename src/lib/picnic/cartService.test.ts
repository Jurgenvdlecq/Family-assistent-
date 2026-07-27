/**
 * Integratietest tegen een echte (lokale) Postgres — alleen de externe
 * Picnic-HTTP-aanroep wordt vervangen door een fake fetch (Fase 7/8: er is
 * geen testomgeving voor de niet-officiële Picnic-API). De idempotentie
 * (een al overgedragen regel wordt overgeslagen, geen dubbele netwerkcall)
 * is precies het gedrag dat een gemockte Prisma-laag zou wegpoetsen.
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../prisma";
import { addShoppingListToPicnicCart, clearPicnicCartForShoppingList } from "./cartService";
import { getCurrentWeekStart } from "../week";

function fakeAddProductFetch(callLog: string[]) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    callLog.push(url);
    if (url.includes("/cart/add_product") || url.includes("/cart/clear")) {
      return new Response(JSON.stringify({}), { headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: { code: "UNKNOWN", message: "onverwacht endpoint" } }), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

async function makeHouseholdWithShoppingListLine(name: string) {
  const household = await prisma.household.create({
    data: {
      name,
      picnicAuthToken: "test-token",
      persons: { create: [{ name: "Test", role: "PARENT" }] },
    },
  });
  const ingredient = await prisma.ingredient.findFirstOrThrow({});
  const product = await prisma.product.create({
    data: { name: "Testproduct", externalRef: `picnic-test-${household.id}`, ingredientId: ingredient.id },
  });
  const variant = await prisma.recipeVariant.findFirstOrThrow({});
  const mealPlan = await prisma.mealPlan.create({
    data: {
      householdId: household.id,
      weekStart: getCurrentWeekStart(),
      status: "CONFIRMED",
      entries: { create: [{ dayOfWeek: "MONDAY", recipeVariantId: variant.id }] },
    },
  });
  const shoppingList = await prisma.shoppingList.create({
    data: {
      mealPlanId: mealPlan.id,
      lines: {
        create: [
          {
            ingredientId: ingredient.id,
            productId: product.id,
            quantity: 1,
            unit: "PIECE",
            source: "MEAL",
            matchStatus: "MATCHED_TRUSTED",
            matchConfidence: 1,
          },
        ],
      },
    },
  });
  return { household, shoppingList };
}

async function cleanup(householdId: string) {
  await prisma.shoppingList.deleteMany({ where: { mealPlan: { householdId } } });
  await prisma.mealPlan.deleteMany({ where: { householdId } });
  await prisma.person.deleteMany({ where: { householdId } });
  await prisma.household.delete({ where: { id: householdId } });
}

test("addShoppingListToPicnicCart: idempotent — een tweede keer slaat de al overgedragen regel over zonder nieuwe netwerkcall", async () => {
  const originalFetch = global.fetch;
  let household: Awaited<ReturnType<typeof makeHouseholdWithShoppingListLine>>["household"] | undefined;

  try {
    const fixture = await makeHouseholdWithShoppingListLine("WP7 integratietest — idempotent");
    household = fixture.household;
    const shoppingList = fixture.shoppingList;
    const callLog: string[] = [];
    global.fetch = fakeAddProductFetch(callLog);

    const first = await addShoppingListToPicnicCart(shoppingList.id);
    assert.equal(first.added.length, 1);
    assert.equal(first.skipped.length, 0);
    assert.equal(callLog.filter((u) => u.includes("/cart/add_product")).length, 1);

    const line = await prisma.shoppingListLine.findFirstOrThrow({ where: { shoppingListId: shoppingList.id } });
    assert.ok(line.transferredToPicnicAt, "regel moet nu een transferredToPicnicAt hebben");

    const callsBeforeSecondRun = callLog.length;
    const second = await addShoppingListToPicnicCart(shoppingList.id);
    assert.equal(second.added.length, 0, "geen nieuwe toevoeging");
    assert.equal(second.skipped.length, 1, "de regel wordt overgeslagen, niet opnieuw geprobeerd");
    assert.equal(
      callLog.length,
      callsBeforeSecondRun,
      "geen enkele nieuwe netwerkcall bij de tweede, idempotente aanroep"
    );
  } finally {
    global.fetch = originalFetch;
    if (household) await cleanup(household.id);
  }
});

test("clearPicnicCartForShoppingList: zet transferredToPicnicAt terug zodat een volgende add-poging alles opnieuw plaatst", async () => {
  const originalFetch = global.fetch;
  let household: Awaited<ReturnType<typeof makeHouseholdWithShoppingListLine>>["household"] | undefined;

  try {
    const fixture = await makeHouseholdWithShoppingListLine("WP7 integratietest — mandje legen");
    household = fixture.household;
    const shoppingList = fixture.shoppingList;
    const callLog: string[] = [];
    global.fetch = fakeAddProductFetch(callLog);

    await addShoppingListToPicnicCart(shoppingList.id);
    let line = await prisma.shoppingListLine.findFirstOrThrow({ where: { shoppingListId: shoppingList.id } });
    assert.ok(line.transferredToPicnicAt);

    await clearPicnicCartForShoppingList(shoppingList.id);
    line = await prisma.shoppingListLine.findFirstOrThrow({ where: { shoppingListId: shoppingList.id } });
    assert.equal(line.transferredToPicnicAt, null);

    const second = await addShoppingListToPicnicCart(shoppingList.id);
    assert.equal(second.added.length, 1, "na het legen van het mandje moet de regel opnieuw worden toegevoegd");
  } finally {
    global.fetch = originalFetch;
    if (household) await cleanup(household.id);
  }
});
