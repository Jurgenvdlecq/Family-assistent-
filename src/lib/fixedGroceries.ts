import { prisma } from "./prisma";
import type { Unit } from "@/generated/prisma/enums";

/**
 * Vaste, terugkerende boodschappen van een huishouden (melk, koffie, kaas…)
 * — los van wat er in het weekmenu staat (sectie "Vaste boodschappen",
 * Fase 4 van het ontwerpdocument). Eén rij per ingrediënt per huishouden
 * (afgedwongen door een unieke index), zodat "toevoegen" van iets dat er al
 * staat gewoon de hoeveelheid bijwerkt in plaats van een dubbele regel te
 * maken.
 */
export async function getFixedGroceries(householdId: string) {
  return prisma.fixedGrocery.findMany({
    where: { householdId },
    include: { ingredient: true },
    orderBy: { ingredient: { name: "asc" } },
  });
}

export async function upsertFixedGrocery(
  householdId: string,
  ingredientId: string,
  quantity: number,
  unit: Unit
) {
  return prisma.fixedGrocery.upsert({
    where: { householdId_ingredientId: { householdId, ingredientId } },
    update: { quantity, unit },
    create: { householdId, ingredientId, quantity, unit },
  });
}

export async function removeFixedGrocery(householdId: string, ingredientId: string) {
  await prisma.fixedGrocery.deleteMany({ where: { householdId, ingredientId } });
}

/** Ingrediënten die nog niet als vaste boodschap zijn ingesteld — voor het "toevoegen"-formulier. */
export async function getIngredientsWithoutFixedGrocery(householdId: string) {
  const existing = await prisma.fixedGrocery.findMany({
    where: { householdId },
    select: { ingredientId: true },
  });
  const existingIds = existing.map((f) => f.ingredientId);
  return prisma.ingredient.findMany({
    where: existingIds.length > 0 ? { id: { notIn: existingIds } } : undefined,
    orderBy: { name: "asc" },
  });
}
