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

    // Geen dubbele regel voor hetzelfde ingrediënt: de herbouw moet het
    // bewaarde exemplaar respecteren i.p.v. er eentje naast te zetten.
    const sameIngredient = after!.lines.filter((line) => line.ingredientId === transferredLine.ingredientId);
    assert.equal(sameIngredient.length, 1, "het bewaarde ingrediënt mag niet dubbel op de lijst komen");

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

test("een bevestigde lijst gaat terug naar 'controleren' als de herbouw nieuwe twijfelgevallen oplevert", async () => {
  const household = await makeHousehold("Invalidate — bevestiging vervalt");
  try {
    const mealPlan = await ensureMealPlan(household.id, getCurrentWeekStart());
    const shoppingList = await ensureShoppingList(mealPlan!.id, household.id);

    // Eén regel als "al in het mandje" markeren, zodat de herbouwtak draait.
    await prisma.shoppingListLine.update({
      where: { id: shoppingList.lines[0].id },
      data: { transferredToPicnicAt: new Date() },
    });
    // En de lijst als bevestigd markeren, zoals /controle dat doet.
    await prisma.shoppingList.update({
      where: { id: shoppingList.id },
      data: { status: "REVIEWED", reviewedAt: new Date(), reviewFlaggedAt: null },
    });

    await invalidateShoppingList(mealPlan!.id);

    const after = await prisma.shoppingList.findUniqueOrThrow({
      where: { mealPlanId: mealPlan!.id },
      include: { lines: true },
    });
    const hasReviewLines = after.lines.some((line) => line.needsReview && line.transferredToPicnicAt === null);

    if (hasReviewLines) {
      assert.equal(after.status, "PREPARED", "met nieuwe twijfelgevallen mag de lijst niet 'bevestigd' blijven");
      assert.equal(after.reviewedAt, null, "de oude bevestiging dekt de nieuwe regels niet meer");
      assert.ok(after.reviewFlaggedAt, "de controle-klok moet lopen zodat de app dit als aandachtspunt toont");
    } else {
      // Alle herbouwde regels waren vertrouwd: dan blijft de bevestiging
      // terecht staan — er is niets ongecontroleerds bijgekomen.
      assert.equal(after.status, "REVIEWED");
    }
  } finally {
    await cleanup(household.id);
  }
});
