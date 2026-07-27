-- CreateTable
CREATE TABLE "day_routines" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "day_of_week" "day_of_week" NOT NULL,
    "recipe_variant_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "day_routines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "day_routines_household_id_day_of_week_key" ON "day_routines"("household_id", "day_of_week");

-- AddForeignKey
ALTER TABLE "day_routines" ADD CONSTRAINT "day_routines_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_routines" ADD CONSTRAINT "day_routines_recipe_variant_id_fkey" FOREIGN KEY ("recipe_variant_id") REFERENCES "recipe_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
