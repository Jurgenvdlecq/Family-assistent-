-- AlterTable
CREATE UNIQUE INDEX "fixed_groceries_household_id_ingredient_id_key" ON "fixed_groceries"("household_id", "ingredient_id");
