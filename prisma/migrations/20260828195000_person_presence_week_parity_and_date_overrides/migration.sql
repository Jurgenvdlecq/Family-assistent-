-- Weekritme, deel 1: aanwezigheid kan een oneven/even-patroon volgen en per
-- concrete datum een uitzondering hebben.
--
-- De bestaande rijen krijgen 'EVERY' (de kolomstandaard) en blijven zich dus
-- exact gedragen zoals vóór deze migratie. De unieke sleutel op
-- person_presence_overrides gaat van (persoon, dag) naar (persoon, dag,
-- pariteit), zodat er per weeksoort een eigen regel kan bestaan.

-- CreateEnum
CREATE TYPE "week_parity" AS ENUM ('EVERY', 'ODD', 'EVEN');

-- DropIndex
DROP INDEX "person_presence_overrides_person_id_day_of_week_key";

-- AlterTable
ALTER TABLE "person_presence_overrides" ADD COLUMN     "week_parity" "week_parity" NOT NULL DEFAULT 'EVERY';

-- CreateTable
CREATE TABLE "person_presence_date_overrides" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "present" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_presence_date_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "person_presence_date_overrides_person_id_date_idx" ON "person_presence_date_overrides"("person_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "person_presence_date_overrides_person_id_date_key" ON "person_presence_date_overrides"("person_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "person_presence_overrides_person_id_day_of_week_week_parity_key" ON "person_presence_overrides"("person_id", "day_of_week", "week_parity");

-- AddForeignKey
ALTER TABLE "person_presence_date_overrides" ADD CONSTRAINT "person_presence_date_overrides_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
