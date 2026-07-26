/**
 * Integratietest tegen een echte (lokale) Postgres — precies de
 * samenwerking tussen HouseholdProductPreference/RejectedProductMatch en de
 * pure matcher is het risico dat een mock zou wegpoetsen (Fase 15: "voeg
 * integratietests toe voor... productmatch controleren, voorkeur opslaan").
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import {
  getTrustedPreferences,
  getRejectedProductIds,
  recordProductChosen,
  recordProductRejected,
} from "./repository";
import { matchProductForIngredient } from "./matchIngredient";

async function cleanup(householdId: string) {
  await prisma.householdProductPreference.deleteMany({ where: { householdId } });
  await prisma.rejectedProductMatch.deleteMany({ where: { householdId } });
  await prisma.household.delete({ where: { id: householdId } });
}

test("recordProductChosen: eerste keer maakt een voorkeur met timesChosen 1", async () => {
  const household = await prisma.household.create({ data: { name: "WP5 integratietest — eerste keuze" } });
  const kipfilet = await prisma.ingredient.findUniqueOrThrow({ where: { name: "Kipfilet" } });
  const product = await prisma.product.findFirstOrThrow({ where: { ingredientId: kipfilet.id } });

  try {
    await recordProductChosen(household.id, kipfilet.id, product.id);
    const trusted = await getTrustedPreferences(household.id, [kipfilet.id]);
    assert.deepEqual(trusted.get(kipfilet.id), { productId: product.id, timesChosen: 1 });
  } finally {
    await cleanup(household.id);
  }
});

test("recordProductChosen: hetzelfde product nogmaals verhoogt timesChosen", async () => {
  const household = await prisma.household.create({ data: { name: "WP5 integratietest — herhaalde keuze" } });
  const kipfilet = await prisma.ingredient.findUniqueOrThrow({ where: { name: "Kipfilet" } });
  const product = await prisma.product.findFirstOrThrow({ where: { ingredientId: kipfilet.id } });

  try {
    await recordProductChosen(household.id, kipfilet.id, product.id);
    await recordProductChosen(household.id, kipfilet.id, product.id);
    await recordProductChosen(household.id, kipfilet.id, product.id);
    const trusted = await getTrustedPreferences(household.id, [kipfilet.id]);
    assert.equal(trusted.get(kipfilet.id)?.timesChosen, 3);
  } finally {
    await cleanup(household.id);
  }
});

test("recordProductChosen: een ander product reset de telling (het oude aantal zegt niets over het nieuwe product)", async () => {
  const household = await prisma.household.create({ data: { name: "WP5 integratietest — ander product" } });
  const kipfilet = await prisma.ingredient.findUniqueOrThrow({ where: { name: "Kipfilet" } });
  const products = await prisma.product.findMany({ where: { ingredientId: kipfilet.id } });
  if (products.length < 2) throw new Error("Deze test heeft minstens 2 Kipfilet-producten in de seed nodig.");

  try {
    await recordProductChosen(household.id, kipfilet.id, products[0].id);
    await recordProductChosen(household.id, kipfilet.id, products[0].id);
    await recordProductChosen(household.id, kipfilet.id, products[1].id);
    const trusted = await getTrustedPreferences(household.id, [kipfilet.id]);
    assert.deepEqual(trusted.get(kipfilet.id), { productId: products[1].id, timesChosen: 1 });
  } finally {
    await cleanup(household.id);
  }
});

test("recordProductRejected sluit een product uit van toekomstige matches voor dit ingrediënt", async () => {
  const household = await prisma.household.create({ data: { name: "WP5 integratietest — afwijzen" } });
  const kipfilet = await prisma.ingredient.findUniqueOrThrow({ where: { name: "Kipfilet" } });
  const products = await prisma.product.findMany({ where: { ingredientId: kipfilet.id } });
  if (products.length < 2) throw new Error("Deze test heeft minstens 2 Kipfilet-producten in de seed nodig.");

  try {
    await recordProductRejected(household.id, kipfilet.id, products[0].id, "te duur");
    const rejected = await getRejectedProductIds(household.id, [kipfilet.id]);
    assert.ok(rejected.get(kipfilet.id)?.has(products[0].id));

    const match = await matchProductForIngredient(household.id, kipfilet.id);
    assert.notEqual(match.productId, products[0].id);
  } finally {
    await cleanup(household.id);
  }
});

test("een expliciet gekozen product levert MATCHED_TRUSTED op via de volledige matchIngredient-flow", async () => {
  const household = await prisma.household.create({ data: { name: "WP5 integratietest — end-to-end" } });
  const kipfilet = await prisma.ingredient.findUniqueOrThrow({ where: { name: "Kipfilet" } });
  const products = await prisma.product.findMany({ where: { ingredientId: kipfilet.id } });

  try {
    // Zonder voorkeur: meerdere kandidaten -> twijfelgeval.
    const before = await matchProductForIngredient(household.id, kipfilet.id);
    assert.equal(before.status, products.length > 1 ? "MATCHED_REVIEW_REQUIRED" : "MATCHED_TRUSTED");

    await recordProductChosen(household.id, kipfilet.id, products[0].id, "MANUAL");
    const after = await matchProductForIngredient(household.id, kipfilet.id);
    assert.equal(after.status, "MATCHED_TRUSTED");
    assert.equal(after.productId, products[0].id);
    assert.ok(after.reasons.some((r) => r.includes("Eerder 1 keer gekozen")));
  } finally {
    await cleanup(household.id);
  }
});
