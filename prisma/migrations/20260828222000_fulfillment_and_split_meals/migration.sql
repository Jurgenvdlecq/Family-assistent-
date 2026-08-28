-- Weekritme, deel 4: herkomst van boodschappen en verdeelde avonden.
--
-- Standaard PICNIC en geen enkele bestaande rij die verandert: een
-- huishouden dat hier niets mee doet, merkt niets.

-- CreateEnum
CREATE TYPE "fulfillment_source" AS ENUM ('PICNIC', 'OTHER_STORE', 'SELF_PROVIDED');

-- AlterTable
ALTER TABLE "shopping_list_lines" ADD COLUMN     "fulfillment" "fulfillment_source" NOT NULL DEFAULT 'PICNIC';

-- CreateTable
CREATE TABLE "household_ingredient_fulfillments" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "fulfillment" "fulfillment_source" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "household_ingredient_fulfillments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_assignments" (
    "id" TEXT NOT NULL,
    "meal_plan_entry_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fulfillment" "fulfillment_source" NOT NULL DEFAULT 'PICNIC',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_assignment_persons" (
    "id" TEXT NOT NULL,
    "meal_assignment_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,

    CONSTRAINT "meal_assignment_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_assignment_items" (
    "id" TEXT NOT NULL,
    "meal_assignment_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "quantity_per_portion" DOUBLE PRECISION NOT NULL,
    "unit" "unit" NOT NULL,

    CONSTRAINT "meal_assignment_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "household_ingredient_fulfillments_household_id_ingredient_i_key" ON "household_ingredient_fulfillments"("household_id", "ingredient_id");

-- CreateIndex
CREATE INDEX "meal_assignments_meal_plan_entry_id_idx" ON "meal_assignments"("meal_plan_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "meal_assignment_persons_meal_assignment_id_person_id_key" ON "meal_assignment_persons"("meal_assignment_id", "person_id");

-- CreateIndex
CREATE INDEX "meal_assignment_items_meal_assignment_id_idx" ON "meal_assignment_items"("meal_assignment_id");

-- AddForeignKey
ALTER TABLE "household_ingredient_fulfillments" ADD CONSTRAINT "household_ingredient_fulfillments_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_ingredient_fulfillments" ADD CONSTRAINT "household_ingredient_fulfillments_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_assignments" ADD CONSTRAINT "meal_assignments_meal_plan_entry_id_fkey" FOREIGN KEY ("meal_plan_entry_id") REFERENCES "meal_plan_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_assignment_persons" ADD CONSTRAINT "meal_assignment_persons_meal_assignment_id_fkey" FOREIGN KEY ("meal_assignment_id") REFERENCES "meal_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_assignment_persons" ADD CONSTRAINT "meal_assignment_persons_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_assignment_items" ADD CONSTRAINT "meal_assignment_items_meal_assignment_id_fkey" FOREIGN KEY ("meal_assignment_id") REFERENCES "meal_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_assignment_items" ADD CONSTRAINT "meal_assignment_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



