-- Aparte vlag voor "neem deze avond mee in de boodschappen", los van
-- `skipped` ("we gaan uit eten"). Zie het commentaar bij MealPlanEntry in
-- prisma/schema.prisma voor waarom dit twee verschillende dingen zijn.
ALTER TABLE "meal_plan_entries" ADD COLUMN     "included_in_groceries" BOOLEAN NOT NULL DEFAULT false;

-- Nieuwe weken zijn opt-in per avond (kolomstandaard `false`), maar wat al
-- gepland stond moet zich blijven gedragen zoals de gebruiker het achterliet:
-- die dagen telden tot nu toe gewoon mee in de boodschappenlijst.
UPDATE "meal_plan_entries" SET "included_in_groceries" = true;
