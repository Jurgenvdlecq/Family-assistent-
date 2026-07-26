-- CreateEnum
CREATE TYPE "inventory_status" AS ENUM ('SUFFICIENT', 'LOW', 'OUT_OF_STOCK', 'UNKNOWN');

-- AlterEnum
ALTER TYPE "line_source" ADD VALUE 'INVENTORY';

-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN     "likely_in_stock" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "status" "inventory_status" NOT NULL DEFAULT 'UNKNOWN',
    "quantity" DOUBLE PRECISION,
    "unit" "unit",
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_household_id_ingredient_id_key" ON "inventory_items"("household_id", "ingredient_id");

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
