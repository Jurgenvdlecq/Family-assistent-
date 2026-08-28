-- Prijslaag P0: prijs als waarneming in de tijd.
--
-- Product.price blijft staan als laatst bekende prijs, zodat elk bestaand
-- scherm ongewijzigd blijft werken.

-- CreateEnum
CREATE TYPE "quality_tier" AS ENUM ('BUDGET', 'STANDAARD', 'PREMIUM', 'BIO');

-- CreateEnum
CREATE TYPE "promo_type" AS ENUM ('GEEN', 'BONUS', 'X_VOOR_Y', 'VOLUME');

-- CreateEnum
CREATE TYPE "observation_source" AS ENUM ('API', 'SCRAPE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "product_provider" ADD VALUE 'AH';
ALTER TYPE "product_provider" ADD VALUE 'DIRK';

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "gtin" TEXT,
ADD COLUMN     "quality_tier" "quality_tier";

-- CreateTable
CREATE TABLE "price_observations" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "was_price" DECIMAL(10,2),
    "unit_price" DECIMAL(10,4),
    "unit_price_unit" "unit",
    "promo_type" "promo_type" NOT NULL DEFAULT 'GEEN',
    "promo_label" TEXT,
    "promo_until" TIMESTAMP(3),
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "observation_source" NOT NULL,

    CONSTRAINT "price_observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_observations_product_id_observed_at_idx" ON "price_observations"("product_id", "observed_at");

-- CreateIndex
CREATE INDEX "products_ingredient_id_provider_idx" ON "products"("ingredient_id", "provider");

-- CreateIndex
CREATE INDEX "products_gtin_idx" ON "products"("gtin");

-- AddForeignKey
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;



