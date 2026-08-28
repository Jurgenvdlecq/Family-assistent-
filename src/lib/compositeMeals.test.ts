/**
 * Integratietest tegen een echte (lokale) Postgres: samengestelde maaltijden
 * van dagregel tot boodschappenlijst.
 *
 * Juist hier is een echte database nodig — het gaat om de samenhang tussen de
 * planner (kiest componenten), het schema (avond zonder recept) en de
 * boodschappenlijst (telt componenten op, per persoon in plaats van per gezin).
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { ensureMealPlan } from "./mealPlan";
import { ensureShoppingList, invalidateShoppingList } from "./shoppingList";
import { getCurrentWeekStart } from "./week";
import { mealEntryTitle } from "@/domain/meal-planning/mealEntry";

/** Vier eters: twee volwassenen (1,0) en twee kinderen (0,7) — samen 3,4 porties. */
async function makeHousehold(name: string, hardRestrictions: string[] = []) {
  return prisma.household.create({
    data: {
      name,
      persons: {
        create: [
          { name: "Ouder 1", role: "PARENT", portionMultiplier: 1 },
          { name: "Ouder 2", role: "PARENT", portionMultiplier: 1 },
          { name: "Kind 1", role: "CHILD", portionMultiplier: 0.7, hardRestrictions },
          { name: "Kind 2", role: "CHILD", portionMultiplier: 0.7 },
        ],
      },
    },
  });
}

const PRESENT_PORTIONS = 3.4;

async function ingredientId(name: string) {
  const ingredient = await prisma.ingredient.findUniqueOrThrow({ where: { name } });
  return ingredient.id;
}

/** Een AVG-sjabloon zoals in de opdracht: aardappel + vlees + groente. */
async function makeAvgTemplate(householdId: string) {
  const [aardappelen, schnitzel, hamburgers, broccoli, sperziebonen, bloemkool] = await Promise.all([
    ingredientId("Aardappelen"),
    ingredientId("Schnitzel"),
    ingredientId("Hamburgers (rund)"),
    ingredientId("Broccoli"),
    ingredientId("Sperziebonen"),
    ingredientId("Bloemkool"),
  ]);

  return prisma.mealTemplate.create({
    data: {
      householdId,
      name: "AVG",
      groups: {
        create: [
          {
            role: "BASE",
            name: "Aardappel",
            sortOrder: 0,
            options: {
              create: [{ name: "Aardappelblokjes", ingredientId: aardappelen, quantityPerPortion: 200, unit: "GRAM" }],
            },
          },
          {
            role: "PROTEIN",
            name: "Vlees",
            sortOrder: 1,
            options: {
              create: [
                { name: "Schnitzel", ingredientId: schnitzel, quantityPerPortion: 1, unit: "PIECE" },
                { name: "Hamburger", ingredientId: hamburgers, quantityPerPortion: 1, unit: "PIECE" },
              ],
            },
          },
          {
            role: "VEGETABLE",
            name: "Groente",
            sortOrder: 2,
            options: {
              create: [
                { name: "Broccoli", ingredientId: broccoli, quantityPerPortion: 150, unit: "GRAM" },
                { name: "Sperziebonen", ingredientId: sperziebonen, quantityPerPortion: 150, unit: "GRAM" },
                { name: "Bloemkool", ingredientId: bloemkool, quantityPerPortion: 150, unit: "GRAM" },
              ],
            },
          },
        ],
      },
    },
    include: { groups: { include: { options: true } } },
  });
}

async function cleanup(householdId: string) {
  await prisma.shoppingList.deleteMany({ where: { mealPlan: { householdId } } });
  await prisma.mealPlan.deleteMany({ where: { householdId } });
  await prisma.mealDayRule.deleteMany({ where: { householdId } });
  await prisma.mealTemplate.deleteMany({ where: { householdId } });
  await prisma.mealSuggestion.deleteMany({ where: { householdId } });
  await prisma.feedbackEvent.deleteMany({ where: { householdId } });
  await prisma.preference.deleteMany({ where: { ownerId: householdId } });
  await prisma.person.deleteMany({ where: { householdId } });
  await prisma.household.delete({ where: { id: householdId } });
}

test("samengestelde maaltijd: dinsdag en vrijdag krijgen niet dezelfde combinatie", async () => {
  const household = await makeHousehold("Samenstelling — variatie binnen de week");
  try {
    const template = await makeAvgTemplate(household.id);
    for (const dayOfWeek of ["TUESDAY", "FRIDAY"] as const) {
      await prisma.mealDayRule.create({
        data: {
          householdId: household.id,
          dayOfWeek,
          weekParity: "EVERY",
          profileKey: "FAMILY_AVG_ROTATION",
          mealTemplateId: template.id,
        },
      });
    }

    const mealPlan = await ensureMealPlan(household.id, getCurrentWeekStart());
    const tuesday = mealPlan!.entries.find((entry) => entry.dayOfWeek === "TUESDAY")!;
    const friday = mealPlan!.entries.find((entry) => entry.dayOfWeek === "FRIDAY")!;

    assert.equal(tuesday.recipeVariantId, null, "een samengestelde avond heeft geen receptvariant");
    assert.equal(tuesday.mealTemplateId, template.id);
    assert.equal(tuesday.components.length, 3, "aardappel, vlees en groente");

    const optionNames = (entry: typeof tuesday, role: string) =>
      entry.components.find((component) => component.option.group.role === role)?.option.name;

    assert.notEqual(
      optionNames(friday, "PROTEIN"),
      optionNames(tuesday, "PROTEIN"),
      "vrijdag hoort ander vlees te krijgen dan dinsdag"
    );
    assert.notEqual(
      optionNames(friday, "VEGETABLE"),
      optionNames(tuesday, "VEGETABLE"),
      "vrijdag hoort andere groente te krijgen dan dinsdag"
    );

    // De naam die de gebruiker ziet.
    assert.match(mealEntryTitle(tuesday), / met .* en /);
    assert.match(tuesday.reason ?? "", /^AVG/);
  } finally {
    await cleanup(household.id);
  }
});

test("samengestelde maaltijd: de boodschappen tellen per persoon op", async () => {
  const household = await makeHousehold("Samenstelling — hoeveelheden");
  try {
    const template = await makeAvgTemplate(household.id);
    await prisma.mealDayRule.create({
      data: {
        householdId: household.id,
        dayOfWeek: "TUESDAY",
        weekParity: "EVERY",
        profileKey: "FAMILY_AVG_ROTATION",
        mealTemplateId: template.id,
      },
    });

    const mealPlan = await ensureMealPlan(household.id, getCurrentWeekStart());
    const tuesday = mealPlan!.entries.find((entry) => entry.dayOfWeek === "TUESDAY")!;
    await prisma.mealPlanEntry.update({ where: { id: tuesday.id }, data: { includedInGroceries: true } });
    await invalidateShoppingList(mealPlan!.id);

    const list = await ensureShoppingList(mealPlan!.id, household.id);
    const mealLines = list.lines.filter((line) => line.source === "MEAL");
    const byIngredient = new Map(mealLines.map((line) => [line.ingredient.name, line]));

    // 200 gram aardappel per persoon, 3,4 porties aan tafel.
    const potatoes = byIngredient.get("Aardappelen");
    assert.ok(potatoes, "de aardappelcomponent hoort op de lijst te staan");
    assert.ok(
      Math.abs(potatoes!.quantity - 200 * PRESENT_PORTIONS) < 1e-6,
      `verwacht ${200 * PRESENT_PORTIONS} gram, kreeg ${potatoes!.quantity}`
    );

    const vegetable = mealLines.find((line) =>
      ["Broccoli", "Sperziebonen", "Bloemkool"].includes(line.ingredient.name)
    );
    assert.ok(vegetable, "er hoort een groentecomponent op de lijst te staan");
    assert.ok(Math.abs(vegetable!.quantity - 150 * PRESENT_PORTIONS) < 1e-6);

    const protein = mealLines.find((line) => ["Schnitzel", "Hamburgers (rund)"].includes(line.ingredient.name));
    assert.ok(protein, "er hoort een vleescomponent op de lijst te staan");
    assert.ok(
      Math.abs(protein!.quantity - 1 * PRESENT_PORTIONS) < 1e-6,
      "één stuk per persoon, ook als dat een gebroken getal oplevert — afronden naar verpakkingen gebeurt later"
    );
  } finally {
    await cleanup(household.id);
  }
});

test("samengestelde maaltijd: hetzelfde ingrediënt op twee avonden wordt één regel", async () => {
  const household = await makeHousehold("Samenstelling — ontdubbelen over avonden");
  try {
    const template = await makeAvgTemplate(household.id);
    for (const dayOfWeek of ["TUESDAY", "FRIDAY"] as const) {
      await prisma.mealDayRule.create({
        data: {
          householdId: household.id,
          dayOfWeek,
          weekParity: "EVERY",
          profileKey: "FAMILY_AVG_ROTATION",
          mealTemplateId: template.id,
        },
      });
    }

    const mealPlan = await ensureMealPlan(household.id, getCurrentWeekStart());
    await prisma.mealPlanEntry.updateMany({
      where: { mealPlanId: mealPlan!.id, dayOfWeek: { in: ["TUESDAY", "FRIDAY"] } },
      data: { includedInGroceries: true },
    });
    await invalidateShoppingList(mealPlan!.id);

    const list = await ensureShoppingList(mealPlan!.id, household.id);
    const potatoLines = list.lines.filter(
      (line) => line.source === "MEAL" && line.ingredient.name === "Aardappelen"
    );
    assert.equal(potatoLines.length, 1, "aardappel mag maar één regel zijn, ook al staat hij twee avonden op tafel");
    assert.ok(
      Math.abs(potatoLines[0].quantity - 2 * 200 * PRESENT_PORTIONS) < 1e-6,
      "de hoeveelheid van beide avonden hoort bij elkaar opgeteld te zijn"
    );
  } finally {
    await cleanup(household.id);
  }
});

test("samengestelde maaltijd: een allergie haalt alleen die optie weg, niet de hele avond", async () => {
  // Kind 1 mag geen gluten; de schnitzel uit de seed heeft die tag niet, dus
  // dit test het algemene mechanisme met een beperking die wél een van de
  // opties raakt.
  const household = await makeHousehold("Samenstelling — allergie op één component", ["gluten"]);
  try {
    const template = await makeAvgTemplate(household.id);
    // Een broodje toevoegen aan het vleescomponent: dat bevat gluten.
    const brood = await prisma.ingredient.findUniqueOrThrow({ where: { name: "Broodjes (burger)" } });
    const proteinGroup = template.groups.find((group) => group.role === "PROTEIN")!;
    await prisma.mealComponentOption.create({
      data: {
        mealComponentGroupId: proteinGroup.id,
        name: "Broodje burger",
        ingredientId: brood.id,
        quantityPerPortion: 1,
        unit: "PIECE",
      },
    });

    await prisma.mealDayRule.create({
      data: {
        householdId: household.id,
        dayOfWeek: "TUESDAY",
        weekParity: "EVERY",
        profileKey: "FAMILY_AVG_ROTATION",
        mealTemplateId: template.id,
      },
    });

    const mealPlan = await ensureMealPlan(household.id, getCurrentWeekStart());
    const tuesday = mealPlan!.entries.find((entry) => entry.dayOfWeek === "TUESDAY")!;

    assert.equal(tuesday.components.length, 3, "de avond blijft compleet");
    const proteinName = tuesday.components.find((component) => component.option.group.role === "PROTEIN")?.option.name;
    assert.notEqual(proteinName, "Broodje burger", "een optie met gluten mag niet gekozen worden");
    assert.ok(proteinName, "er moet wél een vleescomponent gekozen zijn");
  } finally {
    await cleanup(household.id);
  }
});
