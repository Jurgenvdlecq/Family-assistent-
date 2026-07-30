import { prisma } from "./prisma";
import { assertCurrentHousehold } from "./auth";

/**
 * Leidt het huishouden af uit de shoppingList-relatie zelf en verifieert
 * dat tegen de huidige sessie — in plaats van een los `shoppingListId`-
 * formulierveld te vertrouwen. Zonder dit zou een aanvrager met een geldige
 * eigen sessie een `shoppingListId` van een ánder huishouden kunnen
 * meesturen en zo in de boodschappenlijst van dat andere huishouden kunnen
 * schrijven, ook al klopt het losse `householdId`-veld wél met de eigen
 * sessie (dat bewijst alleen dát veld, niet de gekoppelde lijst).
 */
export async function assertShoppingListAccess(shoppingListId: string) {
  const shoppingList = await prisma.shoppingList.findUniqueOrThrow({
    where: { id: shoppingListId },
    include: { mealPlan: { select: { householdId: true } } },
  });
  await assertCurrentHousehold(shoppingList.mealPlan.householdId);
  return shoppingList;
}
