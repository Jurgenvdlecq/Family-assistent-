CREATE TYPE "recipe_scope" AS ENUM ('GLOBAL', 'HOUSEHOLD', 'COMMUNITY_CANDIDATE', 'COMMUNITY_APPROVED');

ALTER TABLE "recipes"
  ADD COLUMN "scope" "recipe_scope" NOT NULL DEFAULT 'GLOBAL',
  ADD COLUMN "household_id" TEXT,
  ADD COLUMN "origin_household_id" TEXT,
  ADD COLUMN "promoted_at" TIMESTAMP(3);

DROP INDEX IF EXISTS "recipes_title_key";

CREATE INDEX "recipes_scope_household_id_title_idx" ON "recipes"("scope", "household_id", "title");

CREATE UNIQUE INDEX "recipes_global_title_key"
  ON "recipes"("title")
  WHERE "scope" = 'GLOBAL';

CREATE UNIQUE INDEX "recipes_household_title_key"
  ON "recipes"("household_id", "title")
  WHERE "household_id" IS NOT NULL;

ALTER TABLE "recipes"
  ADD CONSTRAINT "recipes_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "households"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recipes"
  ADD CONSTRAINT "recipes_origin_household_id_fkey"
  FOREIGN KEY ("origin_household_id") REFERENCES "households"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
