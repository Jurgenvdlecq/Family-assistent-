-- CreateEnum
CREATE TYPE "product_preference_source" AS ENUM ('MANUAL', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "match_status" AS ENUM ('MATCHED_TRUSTED', 'MATCHED_REVIEW_REQUIRED', 'NOT_FOUND', 'MANUALLY_SELECTED', 'UNAVAILABLE');

-- AlterTable
ALTER TABLE "shopping_list_lines" ADD COLUMN     "match_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "match_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "match_status" "match_status" NOT NULL DEFAULT 'NOT_FOUND';

-- CreateTable
CREATE TABLE "household_product_preferences" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "times_chosen" INTEGER NOT NULL DEFAULT 1,
    "last_chosen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "source" "product_preference_source" NOT NULL DEFAULT 'MANUAL',

    CONSTRAINT "household_product_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rejected_product_matches" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "reason" TEXT,
    "rejected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rejected_product_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "household_product_preferences_household_id_ingredient_id_key" ON "household_product_preferences"("household_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "rejected_product_matches_household_id_ingredient_id_product_key" ON "rejected_product_matches"("household_id", "ingredient_id", "product_id");

-- AddForeignKey
ALTER TABLE "household_product_preferences" ADD CONSTRAINT "household_product_preferences_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_product_preferences" ADD CONSTRAINT "household_product_preferences_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_product_preferences" ADD CONSTRAINT "household_product_preferences_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejected_product_matches" ADD CONSTRAINT "rejected_product_matches_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejected_product_matches" ADD CONSTRAINT "rejected_product_matches_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejected_product_matches" ADD CONSTRAINT "rejected_product_matches_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

