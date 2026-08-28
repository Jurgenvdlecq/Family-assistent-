/**
 * Integratietest tegen een echte (lokale) Postgres via DATABASE_URL.
 *
 * Kern van deze test: een boodschappenlijstregel die al naar het
 * Picnic-mandje is overgedragen mag bij een weekmenuwijziging nooit
 * verdwijnen. Zou dat wél gebeuren, dan vergeet de app wat er al in het
 * mandje ligt en bestelt een volgende "Toevoegen aan Picnic-mandje" alles
 * nog een keer — de idempotentie in `cartService` leunt volledig op de
 * `transferredToPicnicAt`-markering op die regel.
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { ensureMealPlan } from "./mealPlan";
import { ensureShoppingList, invalidateShoppingList } from "./shoppingList";
import { getCurrentWeekStart } from "./week";

/**
 * Vinkt alle avonden van dit weekplan aan voor de boodschappen. Sinds de
 * dagkeuze is meenemen opt-in per avond (`includedInGroceries` staat standaard
 * uit); deze tests gaan over een week waarin voor elke avond gekookt wordt.
 */
async function includeAllMeals(mealPlanId: string) {
  await prisma.mealPlanEntry.updateMany({ where: { mealPlanId }, data: { includedInGroceries: true } });
}


async function makeHousehold(name: string) {
  return prisma.household.create({ data: { name, persons: { create: [{ name: "Test", role: "PARENT" }] } } });
}

async function cleanup(householdId: string) {
  await prisma.shoppingList.deleteMany({ where: { mealPlan: { householdId } } });
  await prisma.mealPlan.deleteMany({ where: { householdId } });
  await prisma.fixedGrocery.deleteMany({ where: { householdId } });
  await prisma.feedbackEvent.deleteMany({ where: { householdId } });
  await prisma.mealSuggestion.deleteMany({ where: { householdId } });
  await prisma.preference.deleteMany({ where: { ownerId: householdId } });
  await prisma.person.deleteMany({ where: { householdId } });
  await prisma.household.delete({ where: { id: householdId } });
}

test("invalidateShoppingList gooit de lijst gewoon weg zolang er niets is overgedragen", async () => {
  const household = await makeHousehold("Invalidate — niets overgedragen");
  try {
    const mealPlan = await ensureMealPlan(household.id, getCurrentWeekStart());
    await includeAllMeals(mealPlan!.id);
    await ensureShoppingList(mealPlan!.id, household.id);

    await invalidateShoppingList(mealPlan!.id);

    const after = await prisma.shoppingList.findUnique({ where: { mealPlanId: mealPlan!.id } });
    assert.equal(after, null, "zonder overdracht mag de lijst gewoon weg en later lui opnieuw opgebouwd worden");
  } finally {
    await cleanup(household.id);
  }
});

test("een al naar Picnic overgedragen regel overleeft een weekmenuwijziging", async () => {
  const household = await makeHousehold("Invalidate — overgedragen regel blijft");
  try {
    const mealPlan = await ensureMealPlan(household.id, getCurrentWeekStart());
    await includeAllMeals(mealPlan!.id);
    const shoppingList = await ensureShoppingList(mealPlan!.id, household.id);
    assert.ok(shoppingList.lines.length > 0, "testopzet: de lijst moet regels hebben");

    const transferredAt = new Date();
    const transferredLine = shoppingList.lines[0];
    await prisma.shoppingListLine.update({
      where: { id: transferredLine.id },
      data: { transferredToPicnicAt: transferredAt },
    });

    await invalidateShoppingList(mealPlan!.id);

    const after = await prisma.shoppingList.findUnique({
      where: { mealPlanId: mealPlan!.id },
      include: { lines: true },
    });
    assert.ok(after, "de lijst mag niet in zijn geheel verdwijnen als er al iets in het mandje ligt");

    const survivor = after!.lines.find((line) => line.id === transferredLine.id);
    assert.ok(survivor, "de overgedragen regel moet exact dezelfde regel blijven (zelfde id)");
    assert.equal(
      survivor!.transferredToPicnicAt?.getTime(),
      transferredAt.getTime(),
      "de overdrachtsmarkering moet ongewijzigd blijven, anders wordt het product dubbel besteld"
    );

    // Geen dubbele regel voor dezelfde behoefte: de herbouw moet het bewaarde
    // exemplaar respecteren i.p.v. er eentje naast te zetten. Matchen op
    // (ingrediënt + bron + eenheid), want één ingrediënt mag wél tegelijk een
    // MEAL- en een FIXED-regel hebben — zie de aparte test hieronder.
    const sameNeed = after!.lines.filter(
      (line) =>
        line.ingredientId === transferredLine.ingredientId &&
        line.source === transferredLine.source &&
        line.unit === transferredLine.unit
    );
    assert.equal(sameNeed.length, 1, "dezelfde behoefte mag niet dubbel op de lijst komen");

    // De rest van de lijst is wél opnieuw opgebouwd (verse regel-ids).
    const rebuilt = after!.lines.filter((line) => line.id !== transferredLine.id);
    assert.ok(rebuilt.length > 0, "de niet-overgedragen regels horen opnieuw opgebouwd te zijn");
    assert.ok(
      rebuilt.every((line) => line.transferredToPicnicAt === null),
      "verse regels staan nog niet in het mandje"
    );
  } finally {
    await cleanup(household.id);
  }
});

test("een overgedragen vaste boodschap onderdrukt de receptbehoefte voor hetzelfde ingrediënt niet", async () => {
  // Code-review-bevinding: dedupliceren op alleen `ingredientId` liet de
  // MEAL-regel (bv. 900 gram pasta voor het weekmenu) stilzwijgend verdwijnen
  // zodra de FIXED-regel voor datzelfde ingrediënt was overgedragen. Dat is
  // precies de staat na de knop "Vaste boodschappen (n)", die alleen
  // FIXED/MANUAL overdraagt — en `findShoppingListShortfalls` ziet een
  // volledig ontbrekende regel niet, dus het zou onopgemerkt blijven.
  const household = await makeHousehold("Invalidate — FIXED verdringt MEAL niet");
  try {
    const mealPlan = await ensureMealPlan(household.id, getCurrentWeekStart());
    await includeAllMeals(mealPlan!.id);
    const firstList = await ensureShoppingList(mealPlan!.id, household.id);

    const mealLine = firstList.lines.find((line) => line.source === "MEAL");
    assert.ok(mealLine, "testopzet: er moet een MEAL-regel zijn om op voort te bouwen");

    // Ditzelfde ingrediënt ook als vaste boodschap instellen en de lijst
    // opnieuw laten opbouwen, zodat er echt twee regels naast elkaar staan.
    await prisma.fixedGrocery.create({
      data: { householdId: household.id, ingredientId: mealLine!.ingredientId, quantity: 1, unit: "PIECE" },
    });
    await invalidateShoppingList(mealPlan!.id);
    const rebuilt = await ensureShoppingList(mealPlan!.id, household.id);

    const mealForIngredient = rebuilt.lines.find(
      (line) => line.ingredientId === mealLine!.ingredientId && line.source === "MEAL"
    );
    const fixedForIngredient = rebuilt.lines.find(
      (line) => line.ingredientId === mealLine!.ingredientId && line.source === "FIXED"
    );
    assert.ok(mealForIngredient, "testopzet: MEAL-regel moet bestaan");
    assert.ok(fixedForIngredient, "testopzet: FIXED-regel moet bestaan");

    // Alleen de vaste boodschap is overgedragen (zoals na "Vaste boodschappen (n)").
    await prisma.shoppingListLine.update({
      where: { id: fixedForIngredient!.id },
      data: { transferredToPicnicAt: new Date() },
    });

    await invalidateShoppingList(mealPlan!.id);

    const after = await prisma.shoppingList.findUniqueOrThrow({
      where: { mealPlanId: mealPlan!.id },
      include: { lines: true },
    });
    const mealAfter = after.lines.filter(
      (line) => line.ingredientId === mealLine!.ingredientId && line.source === "MEAL"
    );
    assert.equal(
      mealAfter.length,
      1,
      "de receptbehoefte moet blijven bestaan, ook al is de vaste boodschap voor hetzelfde ingrediënt al overgedragen"
    );
    assert.equal(mealAfter[0].transferredToPicnicAt, null, "die receptbehoefte ligt nog níét in het mandje");

    const fixedAfter = after.lines.filter(
      (line) => line.ingredientId === mealLine!.ingredientId && line.source === "FIXED"
    );
    assert.equal(fixedAfter.length, 1, "de overgedragen vaste boodschap blijft precies één keer staan");
    assert.ok(fixedAfter[0].transferredToPicnicAt, "en behoudt zijn overdrachtsmarkering");
  } finally {
    await cleanup(household.id);
  }
});

test("een bevestigde lijst gaat terug naar 'controleren' als de herbouw nieuwe twijfelgevallen oplevert", async () => {
  const household = await makeHousehold("Invalidate — bevestiging vervalt");
  try {
    const mealPlan = await ensureMealPlan(household.id, getCurrentWeekStart());
    await includeAllMeals(mealPlan!.id);
    const shoppingList = await ensureShoppingList(mealPlan!.id, household.id);

    // Eén regel als "al in het mandje" markeren, zodat de herbouwtak draait.
    await prisma.shoppingListLine.update({
      where: { id: shoppingList.lines[0].id },
      data: { transferredToPicnicAt: new Date() },
    });
    // De overige regels moeten na herbouw twijfelgevallen opleveren, anders
    // toetst deze test niets. Expliciet als testopzet vastleggen i.p.v. de
    // assertions conditioneel maken (code-review-bevinding).
    const reviewLinesInFixture = shoppingList.lines.filter(
      (line) => line.needsReview && line.id !== shoppingList.lines[0].id
    );
    assert.ok(
      reviewLinesInFixture.length > 0,
      "testopzet: de opgebouwde lijst moet twijfelgevallen bevatten om dit gedrag te kunnen toetsen"
    );
    // En de lijst als bevestigd markeren, zoals /controle dat doet.
    await prisma.shoppingList.update({
      where: { id: shoppingList.id },
      data: { status: "REVIEWED", reviewedAt: new Date(), reviewFlaggedAt: null, orderConfirmedAt: new Date() },
    });

    await invalidateShoppingList(mealPlan!.id);

    const after = await prisma.shoppingList.findUniqueOrThrow({
      where: { mealPlanId: mealPlan!.id },
      include: { lines: true },
    });

    assert.equal(after.status, "PREPARED", "met nieuwe twijfelgevallen mag de lijst niet 'bevestigd' blijven");
    assert.equal(after.reviewedAt, null, "de oude bevestiging dekt de nieuwe regels niet meer");
    assert.ok(after.reviewFlaggedAt, "de controle-klok moet lopen zodat de app dit als aandachtspunt toont");
    assert.equal(
      after.orderConfirmedAt,
      null,
      "'ik heb besteld' dekt de nieuwe regels niet — anders verdwijnt de herinnering om af te rekenen"
    );
  } finally {
    await cleanup(household.id);
  }
});
