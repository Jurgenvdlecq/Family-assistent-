-- Weekritme, deel 2: dagregels per weekdag en weeksoort.
--
-- Geen rijen = het huidige gedrag: de planner valt terug op de bestaande
-- scoring en op DayRoutine. Wie er mee-eet staat bewust niet in deze tabel,
-- dat blijft de aanwezigheidstabel.

-- CreateTable
CREATE TABLE "meal_day_rules" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "day_of_week" "day_of_week" NOT NULL,
    "week_parity" "week_parity" NOT NULL DEFAULT 'EVERY',
    "profile_key" TEXT NOT NULL,
    "fixed_recipe_variant_id" TEXT,
    "preferred_category" "recipe_category",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meal_day_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meal_day_rules_household_id_idx" ON "meal_day_rules"("household_id");

-- CreateIndex
CREATE UNIQUE INDEX "meal_day_rules_household_id_day_of_week_week_parity_key" ON "meal_day_rules"("household_id", "day_of_week", "week_parity");

-- AddForeignKey
ALTER TABLE "meal_day_rules" ADD CONSTRAINT "meal_day_rules_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_day_rules" ADD CONSTRAINT "meal_day_rules_fixed_recipe_variant_id_fkey" FOREIGN KEY ("fixed_recipe_variant_id") REFERENCES "recipe_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;



