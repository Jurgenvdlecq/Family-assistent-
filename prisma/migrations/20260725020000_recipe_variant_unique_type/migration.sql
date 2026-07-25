-- DropIndex
DROP INDEX "recipe_variants_recipe_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "recipe_variants_recipe_id_variant_type_key" ON "recipe_variants"("recipe_id", "variant_type");
