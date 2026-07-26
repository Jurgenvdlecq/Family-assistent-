ALTER TABLE "households" ADD COLUMN "access_code_hash" TEXT;

CREATE TABLE "household_sessions" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "household_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "household_sessions_token_hash_key" ON "household_sessions"("token_hash");
CREATE INDEX "household_sessions_household_id_idx" ON "household_sessions"("household_id");
CREATE INDEX "household_sessions_expires_at_idx" ON "household_sessions"("expires_at");

ALTER TABLE "household_sessions"
  ADD CONSTRAINT "household_sessions_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "households"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
