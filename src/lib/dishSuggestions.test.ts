/**
 * Integratietest tegen een echte (lokale) Postgres.
 *
 * De herkenning zelf staat los getest in `dishLookup.test.ts`; hier gaat het
 * om wat een mock juist zou wegpoetsen: welke gerechten dit huishouden mag
 * zien, en welke ingrediënten er dan uitkomen.
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { findDishesForLines } from "./dishSuggestions";

/**
 * Een titel die uit lósse woorden bestaat.
 *
 * Niet `Testgerecht ${Date.now()}`: getallen tellen niet mee in de
 * woordvergelijking, dus élke run zou dezelfde woorden opleveren en dan
 * weigert de herkenning terecht te kiezen tussen twee gelijknamige gerechten.
 */
function uniekeTitel(voorvoegsel: string) {
  const letters = Array.from({ length: 10 }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("");
  return `${voorvoegsel} ${letters}`;
}

async function maakGerecht(titel: string, opties: { householdId?: string } = {}) {
  const ingrediënten = await Promise.all([
    prisma.ingredient.create({
      data: { name: `${titel} hoofdbestanddeel`, unit: "GRAM", category: "PANTRY" },
    }),
    prisma.ingredient.create({
      data: { name: `${titel} basisolie`, unit: "ML", category: "PANTRY", likelyInStock: true },
    }),
  ]);
  return prisma.recipe.create({
    data: {
      title: titel,
      category: "OTHER",
      scope: opties.householdId ? "HOUSEHOLD" : "GLOBAL",
      householdId: opties.householdId ?? null,
      ingredients: {
        create: ingrediënten.map((ingredient) => ({ ingredientId: ingredient.id, quantity: 1, unit: ingredient.unit })),
      },
    },
  });
}

test("een gerecht dat dit huishouden mag zien levert zijn ingrediënten op", async () => {
  const huishouden = await prisma.household.create({ data: { name: `Gerecht-test ${Date.now()}` } });
  const titel = uniekeTitel("Testgerecht");
  await maakGerecht(titel);

  const gevonden = await findDishesForLines(huishouden.id, [{ raw: titel, searchTerm: titel }]);
  const suggestie = gevonden.get(titel);

  assert.ok(suggestie, "het gerecht hoort herkend te worden");
  assert.equal(suggestie.dishTitle, titel);
  // Voorraadbasics gaan er bewust uit, en worden apart gemeld.
  assert.deepEqual(suggestie.ingredientNames, [`${titel} hoofdbestanddeel`]);
  assert.deepEqual(suggestie.skippedNames, [`${titel} basisolie`]);
});

test("een gerecht van een ánder huishouden wordt niet herkend", async () => {
  const eigenaar = await prisma.household.create({ data: { name: `Eigenaar ${Date.now()}` } });
  const buitenstaander = await prisma.household.create({ data: { name: `Buitenstaander ${Date.now()}` } });
  const titel = uniekeTitel("Priveegerecht");
  await maakGerecht(titel, { householdId: eigenaar.id });

  // Tegenproef: de eigenaar ziet 'm wél — anders zou deze test ook slagen als
  // de herkenning helemaal niet werkt.
  const bijEigenaar = await findDishesForLines(eigenaar.id, [{ raw: titel, searchTerm: titel }]);
  assert.ok(bijEigenaar.get(titel), "de eigenaar hoort zijn eigen gerecht wel te zien");

  const bijBuitenstaander = await findDishesForLines(buitenstaander.id, [{ raw: titel, searchTerm: titel }]);
  assert.equal(bijBuitenstaander.get(titel), undefined);
});

test("een gewoon product levert geen gerecht op", async () => {
  const huishouden = await prisma.household.create({ data: { name: `Product-test ${Date.now()}` } });
  const gevonden = await findDishesForLines(huishouden.id, [{ raw: "melk", searchTerm: "melk" }]);
  assert.equal(gevonden.size, 0);
});
