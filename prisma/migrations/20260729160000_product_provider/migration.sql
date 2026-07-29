-- CreateEnum
CREATE TYPE "product_provider" AS ENUM ('PICNIC');

-- DropIndex
DROP INDEX "products_ingredient_id_external_ref_key";

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "provider" "product_provider" NOT NULL DEFAULT 'PICNIC';

-- CreateIndex
CREATE UNIQUE INDEX "products_ingredient_id_provider_external_ref_key" ON "products"("ingredient_id", "provider", "external_ref");
