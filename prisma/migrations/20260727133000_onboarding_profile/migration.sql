CREATE TYPE "onboarding_mode" AS ENUM ('QUICK', 'DETAILED');
CREATE TYPE "planning_style" AS ENUM ('SAFE', 'BALANCED', 'ADVENTUROUS');

ALTER TABLE "households"
  ADD COLUMN "onboarding_mode" "onboarding_mode" NOT NULL DEFAULT 'QUICK',
  ADD COLUMN "planning_style" "planning_style" NOT NULL DEFAULT 'BALANCED',
  ADD COLUMN "max_smart_questions_per_session" INTEGER NOT NULL DEFAULT 2;
