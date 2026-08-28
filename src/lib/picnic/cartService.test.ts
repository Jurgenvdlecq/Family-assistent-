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
      entries: { create: [{ dayOfWeek: "MONDAY", recipeVariantId: variant.id, includedInGroceries: true }] },
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

function fakeAddProductFetchCapturingCount(calls: Array<{ productId: string; count: number }>) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/cart/add_product")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { product_id: string; count: number };
      calls.push({ productId: body.product_id, count: body.count });
      return new Response(JSON.stringify({}), { headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: { code: "UNKNOWN", message: "onverwacht endpoint" } }), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

/**
 * Reproduceert het scenario uit de codereview van WP82: een MANUAL-regel
 * (net als FIXED) laat de gebruiker rechtstreeks een aantal verpakkingen
 * kiezen via `unit: PIECE` — dat aantal mag niet worden herinterpreteerd
 * door de verpakkingsengine, ook al is het onderliggende ingrediënt in
 * werkelijkheid in ML/GRAM gemeten (hier: een fles van 1.500 ml).
 */
async function makeHouseholdWithManualPieceLine(name: string, quantity: number) {
  const household = await prisma.household.create({
    data: {
      name,
      picnicAuthToken: "test-token",
      persons: { create: [{ name: "Test", role: "PARENT" }] },
    },
  });
  const ingredient = await prisma.ingredient.create({
    data: { name: `WP82 testfles ${household.id}`, unit: "ML", category: "OTHER" },
  });
  const product = await prisma.product.create({
    data: {
      name: "Testfles 1,5 liter",
      externalRef: `picnic-test-manual-${household.id}`,
      ingredientId: ingredient.id,
      packageSize: "1,5 liter",
      packageQuantity: 1500,
    },
  });
  const mealPlan = await prisma.mealPlan.create({
    data: { householdId: household.id, weekStart: getCurrentWeekStart(), status: "CONFIRMED" },
  });
  const shoppingList = await prisma.shoppingList.create({
    data: {
      mealPlanId: mealPlan.id,
      lines: {
        create: [
          {
            ingredientId: ingredient.id,
            productId: product.id,
            quantity,
            unit: "PIECE",
            source: "MANUAL",
            matchStatus: "MANUALLY_SELECTED",
            matchConfidence: 1,
            matchReasons: ["Handmatig toegevoegd voor deze week."],
          },
        ],
      },
    },
  });
  return { household, shoppingList, product };
}

test("addShoppingListToPicnicCart: MANUAL-regel met unit PIECE en een ML-product stuurt het letterlijk gekozen aantal, niet de verpakkingsberekening", async () => {
  const originalFetch = global.fetch;
  let household: Awaited<ReturnType<typeof makeHouseholdWithManualPieceLine>>["household"] | undefined;

  try {
    const fixture = await makeHouseholdWithManualPieceLine("WP82 regressietest — MANUAL + PIECE + ML-product", 3);
    household = fixture.household;
    const calls: Array<{ productId: string; count: number }> = [];
    global.fetch = fakeAddProductFetchCapturingCount(calls);

    const result = await addShoppingListToPicnicCart(fixture.shoppingList.id);
    assert.equal(result.added.length, 1);
    assert.equal(calls.length, 1, "precies één add_product-aanroep");
    assert.equal(
      calls[0]!.count,
      3,
      "de gebruiker koos letterlijk 3 stuks — dat mag de verpakkingsengine niet naar 1 herinterpreteren omdat het onderliggende product in ml gemeten is"
    );
  } finally {
    global.fetch = originalFetch;
    if (household) await cleanup(household.id);
  }
});

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

async function makeHouseholdWithMealAndFixedLine(name: string) {
  const household = await prisma.household.create({
    data: {
      name,
      picnicAuthToken: "test-token",
      persons: { create: [{ name: "Test", role: "PARENT" }] },
    },
  });
  const mealIngredient = await prisma.ingredient.findFirstOrThrow({});
  const mealProduct = await prisma.product.create({
    data: { name: "Weekmenu-product", externalRef: `picnic-test-meal-${household.id}`, ingredientId: mealIngredient.id },
  });
  const fixedIngredient = await prisma.ingredient.create({
    data: { name: `WP91 vaste boodschap ${household.id}`, unit: "PIECE", category: "OTHER" },
  });
  const fixedProduct = await prisma.product.create({
    data: { name: "Vaste boodschap", externalRef: `picnic-test-fixed-${household.id}`, ingredientId: fixedIngredient.id },
  });
  const variant = await prisma.recipeVariant.findFirstOrThrow({});
  const mealPlan = await prisma.mealPlan.create({
    data: {
      householdId: household.id,
      weekStart: getCurrentWeekStart(),
      status: "CONFIRMED",
      entries: { create: [{ dayOfWeek: "MONDAY", recipeVariantId: variant.id, includedInGroceries: true }] },
    },
  });
  const shoppingList = await prisma.shoppingList.create({
    data: {
      mealPlanId: mealPlan.id,
      lines: {
        create: [
          {
            ingredientId: mealIngredient.id,
            productId: mealProduct.id,
            quantity: 1,
            unit: "PIECE",
            source: "MEAL",
            matchStatus: "MATCHED_TRUSTED",
            matchConfidence: 1,
          },
          {
            ingredientId: fixedIngredient.id,
            productId: fixedProduct.id,
            quantity: 1,
            unit: "PIECE",
            source: "FIXED",
            matchStatus: "MATCHED_TRUSTED",
            matchConfidence: 1,
          },
        ],
      },
    },
  });
  return { household, shoppingList, fixedProduct };
}

test("addShoppingListToPicnicCart: onlySources beperkt de overdracht tot vaste boodschappen, weekmenu-regel blijft onaangeroerd (WP91)", async () => {
  const originalFetch = global.fetch;
  let household: Awaited<ReturnType<typeof makeHouseholdWithMealAndFixedLine>>["household"] | undefined;

  try {
    const fixture = await makeHouseholdWithMealAndFixedLine("WP91 integratietest — alleen vaste boodschappen");
    household = fixture.household;
    const calls: Array<{ productId: string; count: number }> = [];
    global.fetch = fakeAddProductFetchCapturingCount(calls);

    const result = await addShoppingListToPicnicCart(fixture.shoppingList.id, { onlySources: ["FIXED"] });
    assert.equal(result.added.length, 1, "alleen de FIXED-regel wordt toegevoegd");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.productId, fixture.fixedProduct.externalRef);

    const lines = await prisma.shoppingListLine.findMany({ where: { shoppingListId: fixture.shoppingList.id } });
    const mealLine = lines.find((l) => l.source === "MEAL");
    const fixedLine = lines.find((l) => l.source === "FIXED");
    assert.equal(mealLine?.transferredToPicnicAt, null, "de weekmenu-regel is niet meegestuurd en dus niet overgedragen");
    assert.ok(fixedLine?.transferredToPicnicAt, "de vaste-boodschappenregel is wel overgedragen");
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

    const clearResult = await clearPicnicCartForShoppingList(shoppingList.id);
    assert.equal(clearResult.ok, true);
    line = await prisma.shoppingListLine.findFirstOrThrow({ where: { shoppingListId: shoppingList.id } });
    assert.equal(line.transferredToPicnicAt, null);

    const second = await addShoppingListToPicnicCart(shoppingList.id);
    assert.equal(second.added.length, 1, "na het legen van het mandje moet de regel opnieuw worden toegevoegd");
  } finally {
    global.fetch = originalFetch;
    if (household) await cleanup(household.id);
  }
});

/**
 * Bugfix (gebruikersmelding: "ik kan mn boodschappenlijst niet legen"):
 * clearPicnicCartForShoppingList gooide voorheen een kale Error zodra Picnic
 * een auth-fout teruggaf — clearPicnicCart wordt rechtstreeks als functie
 * vanuit een client component aangeroepen (geen formulier/redirect), dus
 * die throw ging over de Server-Actions-grens en werd door Next.js in
 * productie herleid tot de nietszeggende "An error occurred in the Server
 * Components render"-melding. Nu een resultaat i.p.v. een throw.
 */
test("clearPicnicCartForShoppingList: geeft een Nederlandse foutmelding terug i.p.v. te gooien bij een Picnic-authfout", async () => {
  const originalFetch = global.fetch;
  let household: Awaited<ReturnType<typeof makeHouseholdWithShoppingListLine>>["household"] | undefined;

  try {
    const fixture = await makeHouseholdWithShoppingListLine("Bugfix-test — mandje legen met verlopen sessie");
    household = fixture.household;

    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/cart/clear")) {
        return new Response(
          JSON.stringify({ error: { code: "AUTH_ERROR", message: "Sessie verlopen" } }),
          { headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ error: { code: "UNKNOWN", message: "onverwacht endpoint" } }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await clearPicnicCartForShoppingList(fixture.shoppingList.id);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message, /Picnic-sessie verlopen/, "moet een uitlegbare Nederlandse melding teruggeven, geen kale Picnic-foutcode");
    }
  } finally {
    global.fetch = originalFetch;
    if (household) await cleanup(household.id);
  }
});

test("addShoppingListToPicnicCart: geeft een resultaat terug i.p.v. te gooien zonder gekoppeld Picnic-account", async () => {
  const household = await prisma.household.create({
    data: {
      name: "Bugfix-test — mandje vullen zonder Picnic-koppeling",
      persons: { create: [{ name: "Test", role: "PARENT" }] },
    },
  });
  try {
    const ingredient = await prisma.ingredient.findFirstOrThrow({});
    const variant = await prisma.recipeVariant.findFirstOrThrow({});
    const mealPlan = await prisma.mealPlan.create({
      data: {
        householdId: household.id,
        weekStart: getCurrentWeekStart(),
        status: "CONFIRMED",
        entries: { create: [{ dayOfWeek: "MONDAY", recipeVariantId: variant.id, includedInGroceries: true }] },
      },
    });
    const shoppingList = await prisma.shoppingList.create({
      data: {
        mealPlanId: mealPlan.id,
        lines: {
          create: [
            { ingredientId: ingredient.id, quantity: 1, unit: "PIECE", source: "MEAL", matchStatus: "NOT_FOUND", matchConfidence: 0 },
          ],
        },
      },
    });

    const result = await addShoppingListToPicnicCart(shoppingList.id);
    assert.equal(result.added.length, 0);
    assert.equal(result.stoppedEarly, true);
    assert.match(result.errors[0]?.message ?? "", /Nog geen Picnic-account gekoppeld/);
  } finally {
    await cleanup(household.id);
  }
});

test("clearPicnicCartForShoppingList: geeft een resultaat terug i.p.v. te gooien zonder gekoppeld Picnic-account", async () => {
  const household = await prisma.household.create({
    data: {
      name: "Bugfix-test — mandje legen zonder Picnic-koppeling",
      persons: { create: [{ name: "Test", role: "PARENT" }] },
    },
  });
  try {
    const ingredient = await prisma.ingredient.findFirstOrThrow({});
    const variant = await prisma.recipeVariant.findFirstOrThrow({});
    const mealPlan = await prisma.mealPlan.create({
      data: {
        householdId: household.id,
        weekStart: getCurrentWeekStart(),
        status: "CONFIRMED",
        entries: { create: [{ dayOfWeek: "MONDAY", recipeVariantId: variant.id, includedInGroceries: true }] },
      },
    });
    const shoppingList = await prisma.shoppingList.create({
      data: {
        mealPlanId: mealPlan.id,
        lines: {
          create: [
            { ingredientId: ingredient.id, quantity: 1, unit: "PIECE", source: "MEAL", matchStatus: "NOT_FOUND", matchConfidence: 0 },
          ],
        },
      },
    });

    const result = await clearPicnicCartForShoppingList(shoppingList.id);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message, /Nog geen Picnic-account gekoppeld/);
    }
  } finally {
    await cleanup(household.id);
  }
});

/** Een weekplan voor de vólgende week met één avond aangevinkt voor de boodschappen. */
async function makeNextWeekPlanWithIncludedDay(householdId: string) {
  const variant = await prisma.recipeVariant.findFirstOrThrow({});
  const nextWeek = getCurrentWeekStart();
  nextWeek.setDate(nextWeek.getDate() + 7);
  return prisma.mealPlan.create({
    data: {
      householdId,
      weekStart: nextWeek,
      entries: { create: [{ dayOfWeek: "TUESDAY", recipeVariantId: variant.id, includedInGroceries: true }] },
    },
    include: { entries: true },
  });
}

test("maaltijdboodschappen overdragen zet de dagkeuze van de volgende week terug", async () => {
  // Anders stelt de app hetzelfde, al bezorgde gerecht opnieuw voor zodra die
  // week de huidige wordt — een verse lijst kent de overdrachtsmarkeringen van
  // de vorige bestelling niet.
  const { household, shoppingList } = await makeHouseholdWithShoppingListLine("Cart — dagkeuze vrijgeven");
  const nextWeekPlan = await makeNextWeekPlanWithIncludedDay(household.id);
  const originalFetch = global.fetch;
  global.fetch = fakeAddProductFetch([]);
  try {
    await addShoppingListToPicnicCart(shoppingList.id);

    const entry = await prisma.mealPlanEntry.findUniqueOrThrow({ where: { id: nextWeekPlan.entries[0].id } });
    assert.equal(entry.includedInGroceries, false);
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});

test("een snelle bestelling zonder maaltijdregels laat de dagkeuze met rust", async () => {
  // "Vaste boodschappen + losse toevoegingen" gaat niet over het avondeten,
  // dus die overdracht mag de gekozen avonden niet stilzwijgend uitzetten.
  const { household, shoppingList } = await makeHouseholdWithShoppingListLine("Cart — snelle bestelling");
  const nextWeekPlan = await makeNextWeekPlanWithIncludedDay(household.id);
  const originalFetch = global.fetch;
  global.fetch = fakeAddProductFetch([]);
  try {
    // De lijst bevat alleen een MEAL-regel, dus met deze scope wordt er niets
    // overgedragen — precies het geval dat de dagkeuze niet mag raken.
    const result = await addShoppingListToPicnicCart(shoppingList.id, { onlySources: ["FIXED", "MANUAL"] });
    assert.equal(result.added.length, 0, "testopzet: er mag niets overgedragen zijn");

    const entry = await prisma.mealPlanEntry.findUniqueOrThrow({ where: { id: nextWeekPlan.entries[0].id } });
    assert.equal(entry.includedInGroceries, true, "de gekozen avond moet gewoon blijven staan");
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});

test("mandje legen bouwt de lijst opnieuw op, zodat er niets van de vorige bestelling blijft hangen", async () => {
  // Gebruikersmelding: na het bestellen stonden er producten op de lijst
  // terwijl er geen enkele avond aangevinkt was. Ze bleven staan omdat ze in
  // het echte Picnic-mandje lagen — terecht — maar na het legen van dat mandje
  // hoort de lijst weer te kloppen met wat er nú gekozen is.
  const { household, shoppingList } = await makeHouseholdWithShoppingListLine("Cart — legen bouwt opnieuw op");
  const originalFetch = global.fetch;
  global.fetch = fakeAddProductFetch([]);
  try {
    await addShoppingListToPicnicCart(shoppingList.id);
    // Niemand kookt meer op die avond: de maaltijdregel heeft geen basis meer.
    await prisma.mealPlanEntry.updateMany({
      where: { mealPlan: { householdId: household.id } },
      data: { includedInGroceries: false },
    });

    const beforeClear = await prisma.shoppingListLine.count({ where: { shoppingListId: shoppingList.id } });
    assert.ok(beforeClear > 0, "testopzet: de regel ligt in het mandje en blijft dus staan");

    const result = await clearPicnicCartForShoppingList(shoppingList.id);
    assert.equal(result.ok, true);

    const remaining = await prisma.shoppingListLine.count({
      where: { shoppingList: { mealPlanId: shoppingList.mealPlanId }, source: "MEAL" },
    });
    assert.equal(remaining, 0, "na het legen mag er geen maaltijdregel meer staan zonder aangevinkte avond");
  } finally {
    global.fetch = originalFetch;
    await cleanup(household.id);
  }
});
