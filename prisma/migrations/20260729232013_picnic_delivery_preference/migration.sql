-- AlterEnum
ALTER TYPE "notification_type" ADD VALUE 'PICNIC_DELIVERY_SLOT_AT_RISK';

-- CreateTable
CREATE TABLE "picnic_delivery_preferences" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "preferred_day_of_week" "day_of_week" NOT NULL,
    "preferred_time" TEXT NOT NULL,
    "window_minutes" INTEGER NOT NULL DEFAULT 60,
    "notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "reminder_days_before" INTEGER NOT NULL DEFAULT 2,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "picnic_delivery_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "picnic_delivery_preferences_household_id_key" ON "picnic_delivery_preferences"("household_id");

-- AddForeignKey
ALTER TABLE "picnic_delivery_preferences" ADD CONSTRAINT "picnic_delivery_preferences_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;
