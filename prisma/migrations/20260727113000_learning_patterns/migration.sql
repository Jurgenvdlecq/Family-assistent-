CREATE TYPE "learned_pattern_type" AS ENUM (
  'MEAL_CATEGORY_REPLACED_ON_DAY',
  'MEAL_VARIANT_REPLACED_ON_DAY'
);

CREATE TYPE "learning_prompt_type" AS ENUM (
  'EXPLAIN_REPEATED_REPLACEMENT'
);

CREATE TYPE "learning_status" AS ENUM (
  'CANDIDATE',
  'CONFIRMED',
  'DISMISSED',
  'PENDING',
  'ANSWERED'
);

CREATE TABLE "learned_patterns" (
  "id" TEXT NOT NULL,
  "household_id" TEXT NOT NULL,
  "person_id" TEXT,
  "pattern_type" "learned_pattern_type" NOT NULL,
  "subject_type" "feedback_subject_type",
  "subject_id" TEXT,
  "context_key" TEXT NOT NULL,
  "context" JSONB NOT NULL DEFAULT '{}',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "evidence_count" INTEGER NOT NULL DEFAULT 0,
  "status" "learning_status" NOT NULL DEFAULT 'CANDIDATE',
  "last_observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "learned_patterns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "learning_prompts" (
  "id" TEXT NOT NULL,
  "household_id" TEXT NOT NULL,
  "learned_pattern_id" TEXT,
  "prompt_type" "learning_prompt_type" NOT NULL,
  "trigger" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "status" "learning_status" NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "answered_at" TIMESTAMP(3),
  CONSTRAINT "learning_prompts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "learned_patterns_household_id_pattern_type_subject_type_subject_id_context_key_key"
  ON "learned_patterns"("household_id", "pattern_type", "subject_type", "subject_id", "context_key");

CREATE INDEX "learned_patterns_household_id_status_idx"
  ON "learned_patterns"("household_id", "status");

CREATE INDEX "learning_prompts_household_id_status_created_at_idx"
  ON "learning_prompts"("household_id", "status", "created_at");

ALTER TABLE "learned_patterns"
  ADD CONSTRAINT "learned_patterns_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "households"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "learning_prompts"
  ADD CONSTRAINT "learning_prompts_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "households"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "learning_prompts"
  ADD CONSTRAINT "learning_prompts_learned_pattern_id_fkey"
  FOREIGN KEY ("learned_pattern_id") REFERENCES "learned_patterns"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
