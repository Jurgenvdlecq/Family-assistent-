export function accessibleRecipeWhere(householdId: string) {
  return {
    OR: [
      { scope: "GLOBAL" as const },
      { scope: "COMMUNITY_APPROVED" as const },
      { householdId },
    ],
  };
}

export function editableRecipeWhere(householdId: string, recipeId: string) {
  return {
    id: recipeId,
    householdId,
  };
}

export function isHouseholdRecipe(recipe: { householdId: string | null }) {
  return recipe.householdId !== null;
}
