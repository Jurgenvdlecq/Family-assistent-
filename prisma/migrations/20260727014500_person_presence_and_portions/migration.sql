ALTER TABLE "persons" ADD COLUMN "portion_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1;

CREATE TABLE "person_presence_overrides" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "day_of_week" "day_of_week" NOT NULL,
    "present" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_presence_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "person_presence_overrides_person_id_day_of_week_key"
  ON "person_presence_overrides"("person_id", "day_of_week");
CREATE INDEX "person_presence_overrides_person_id_idx" ON "person_presence_overrides"("person_id");

ALTER TABLE "person_presence_overrides"
  ADD CONSTRAINT "person_presence_overrides_person_id_fkey"
  FOREIGN KEY ("person_id") REFERENCES "persons"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
