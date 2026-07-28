-- CreateEnum
CREATE TYPE "meal_plan_entry_source" AS ENUM ('AUTO', 'MANUAL', 'ASSISTANT', 'REGENERATED');

-- CreateEnum
CREATE TYPE "meal_plan_entry_status" AS ENUM ('PROPOSED', 'ACCEPTED', 'REPLACED');

-- AlterTable
ALTER TABLE "meal_plan_entries" ADD COLUMN     "confidence_level" "confidence_level",
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "replaced_from_recipe_variant_id" TEXT,
ADD COLUMN     "score" DOUBLE PRECISION,
ADD COLUMN     "source" "meal_plan_entry_source" NOT NULL DEFAULT 'AUTO',
ADD COLUMN     "status" "meal_plan_entry_status" NOT NULL DEFAULT 'PROPOSED',
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AddForeignKey
ALTER TABLE "meal_plan_entries" ADD CONSTRAINT "meal_plan_entries_replaced_from_recipe_variant_id_fkey" FOREIGN KEY ("replaced_from_recipe_variant_id") REFERENCES "recipe_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
