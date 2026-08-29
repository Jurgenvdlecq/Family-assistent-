-- CreateEnum
CREATE TYPE "price_refresh_trigger" AS ENUM ('CRON', 'MANUAL');

-- CreateTable
CREATE TABLE "price_refresh_runs" (
    "id" TEXT NOT NULL,
    "provider" "product_provider" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "ingredients_checked" INTEGER NOT NULL DEFAULT 0,
    "products_stored" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "trigger" "price_refresh_trigger" NOT NULL,

    CONSTRAINT "price_refresh_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_refresh_runs_provider_started_at_idx" ON "price_refresh_runs"("provider", "started_at");
