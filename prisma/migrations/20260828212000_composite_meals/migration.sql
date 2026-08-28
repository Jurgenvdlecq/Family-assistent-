-- Weekritme, deel 3: samengestelde maaltijden.
--
-- Een avond is voortaan óf een recept, óf een samenstelling uit componenten.
-- Daarom wordt recipe_variant_id nullable. Alle bestaande rijen hebben een
-- recept, dus voor bestaande weken verandert er niets.

-- CreateEnum
CREATE TYPE "meal_component_role" AS ENUM ('BASE', 'PROTEIN', 'VEGETABLE', 'SIDE', 'SAUCE', 'OTHER');

-- DropForeignKey
ALTER TABLE "meal_plan_entries" DROP CONSTRAINT "meal_plan_entries_recipe_variant_id_fkey";

-- AlterTable
ALTER TABLE "meal_day_rules" ADD COLUMN     "meal_template_id" TEXT;

-- AlterTable
ALTER TABLE "meal_plan_entries" ADD COLUMN     "meal_template_id" TEXT,
ALTER COLUMN "recipe_variant_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "meal_templates" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meal_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_component_groups" (
    "id" TEXT NOT NULL,
    "meal_template_id" TEXT NOT NULL,
    "role" "meal_component_role" NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "meal_component_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_component_options" (
    "id" TEXT NOT NULL,
    "meal_component_group_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "quantity_per_portion" DOUBLE PRECISION NOT NULL,
    "unit" "unit" NOT NULL,

    CONSTRAINT "meal_component_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_plan_entry_components" (
    "id" TEXT NOT NULL,
    "meal_plan_entry_id" TEXT NOT NULL,
    "meal_component_option_id" TEXT NOT NULL,

    CONSTRAINT "meal_plan_entry_components_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meal_templates_household_id_name_key" ON "meal_templates"("household_id", "name");

-- CreateIndex
CREATE INDEX "meal_component_groups_meal_template_id_idx" ON "meal_component_groups"("meal_template_id");

-- CreateIndex
CREATE UNIQUE INDEX "meal_component_groups_meal_template_id_role_key" ON "meal_component_groups"("meal_template_id", "role");

-- CreateIndex
CREATE INDEX "meal_component_options_meal_component_group_id_idx" ON "meal_component_options"("meal_component_group_id");

-- CreateIndex
CREATE INDEX "meal_plan_entry_components_meal_plan_entry_id_idx" ON "meal_plan_entry_components"("meal_plan_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "meal_plan_entry_components_meal_plan_entry_id_meal_componen_key" ON "meal_plan_entry_components"("meal_plan_entry_id", "meal_component_option_id");

-- AddForeignKey
ALTER TABLE "meal_day_rules" ADD CONSTRAINT "meal_day_rules_meal_template_id_fkey" FOREIGN KEY ("meal_template_id") REFERENCES "meal_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_templates" ADD CONSTRAINT "meal_templates_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_component_groups" ADD CONSTRAINT "meal_component_groups_meal_template_id_fkey" FOREIGN KEY ("meal_template_id") REFERENCES "meal_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_component_options" ADD CONSTRAINT "meal_component_options_meal_component_group_id_fkey" FOREIGN KEY ("meal_component_group_id") REFERENCES "meal_component_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_component_options" ADD CONSTRAINT "meal_component_options_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plan_entry_components" ADD CONSTRAINT "meal_plan_entry_components_meal_plan_entry_id_fkey" FOREIGN KEY ("meal_plan_entry_id") REFERENCES "meal_plan_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plan_entry_components" ADD CONSTRAINT "meal_plan_entry_components_meal_component_option_id_fkey" FOREIGN KEY ("meal_component_option_id") REFERENCES "meal_component_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plan_entries" ADD CONSTRAINT "meal_plan_entries_recipe_variant_id_fkey" FOREIGN KEY ("recipe_variant_id") REFERENCES "recipe_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plan_entries" ADD CONSTRAINT "meal_plan_entries_meal_template_id_fkey" FOREIGN KEY ("meal_template_id") REFERENCES "meal_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;



