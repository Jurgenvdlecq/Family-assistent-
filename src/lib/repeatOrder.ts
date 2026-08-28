import { prisma } from "./prisma";
import { getCurrentWeekStart } from "./week";

export function previousWeekStart(): Date {
  const start = getCurrentWeekStart();
  start.setDate(start.getDate() - 7);
  return start;
}

/**
 * De boodschappenlijst van de vorige week, maar alleen als daar echt een
 * bestelling uit is voortgekomen — anders valt er niets te herhalen.
 * "Echt besteld" = er is minstens één regel naar het Picnic-mandje gegaan.
 */
export async function getPreviousOrderSummary(householdId: string) {
  const previousPlan = await prisma.mealPlan.findUnique({
    where: { householdId_weekStart: { householdId, weekStart: previousWeekStart() } },
    include: {
      entries: { select: { dayOfWeek: true, includedInGroceries: true } },
      shoppingList: {
        include: { lines: { select: { source: true, transferredToPicnicAt: true } } },
      },
    },
  });
  if (!previousPlan?.shoppingList) return null;
  if (!previousPlan.shoppingList.lines.some((line) => line.transferredToPicnicAt !== null)) return null;

  return {
    extraCount: previousPlan.shoppingList.lines.filter((line) => line.source === "MANUAL").length,
    cookingDayCount: previousPlan.entries.filter((entry) => entry.includedInGroceries).length,
  };
}

