-- CreateTable
CREATE TABLE "household_store_product_choices" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "provider" "product_provider" NOT NULL,
    "product_id" TEXT NOT NULL,
    "chosen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_store_product_choices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "household_store_product_choices_household_id_ingredient_id__key" ON "household_store_product_choices"("household_id", "ingredient_id", "provider");

-- AddForeignKey
ALTER TABLE "household_store_product_choices" ADD CONSTRAINT "household_store_product_choices_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_store_product_choices" ADD CONSTRAINT "household_store_product_choices_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_store_product_choices" ADD CONSTRAINT "household_store_product_choices_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
