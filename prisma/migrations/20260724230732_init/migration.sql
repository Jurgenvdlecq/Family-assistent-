-- CreateEnum
CREATE TYPE "onboarding_status" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "person_role" AS ENUM ('PARENT', 'CHILD', 'OTHER');

-- CreateEnum
CREATE TYPE "recipe_category" AS ENUM ('PASTA', 'WRAPS', 'RICE_DISH', 'ALL_VEGGIE_DAY', 'QUICK_AND_EASY', 'COMFORT_FOOD', 'AIRFRYER', 'OTHER');

-- CreateEnum
CREATE TYPE "recipe_status" AS ENUM ('FOUND', 'ADAPTED', 'PROVEN', 'SAFE_CHOICE');

-- CreateEnum
CREATE TYPE "variant_type" AS ENUM ('FAST', 'FRESH', 'REHEATABLE', 'KID_FRIENDLY');

-- CreateEnum
CREATE TYPE "meal_plan_status" AS ENUM ('CONCEPT', 'CONFIRMED', 'GROCERIES_READY');

-- CreateEnum
CREATE TYPE "day_of_week" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "confidence_level" AS ENUM ('CERTAIN', 'SLIGHT_DOUBT', 'HIGH_IMPACT');

-- CreateEnum
CREATE TYPE "unit" AS ENUM ('GRAM', 'PIECE', 'ML');

-- CreateEnum
CREATE TYPE "ingredient_category" AS ENUM ('MEAT', 'DAIRY', 'VEGETABLE', 'FRUIT', 'GRAIN', 'PANTRY', 'OTHER');

-- CreateEnum
CREATE TYPE "shopping_list_status" AS ENUM ('PREPARED', 'REVIEWED', 'TRANSFERRED');

-- CreateEnum
CREATE TYPE "line_source" AS ENUM ('MEAL', 'FIXED');

-- CreateEnum
CREATE TYPE "feedback_subject_type" AS ENUM ('RECIPE_VARIANT', 'PRODUCT', 'INGREDIENT');

-- CreateEnum
CREATE TYPE "feedback_event_type" AS ENUM ('CHOSEN', 'REPLACED', 'IGNORED', 'EXPLICIT_FEEDBACK');

-- CreateEnum
CREATE TYPE "preference_owner_type" AS ENUM ('HOUSEHOLD', 'PERSON');

-- CreateEnum
CREATE TYPE "stance" AS ENUM ('LIKED', 'SOMETIMES', 'RATHER_NOT', 'NEVER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "preference_source" AS ENUM ('EXPLICIT', 'INFERRED');

-- CreateTable
CREATE TABLE "households" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weekly_rhythm" JSONB NOT NULL DEFAULT '{}',
    "delivery_preference" JSONB NOT NULL DEFAULT '{}',
    "onboarding_status" "onboarding_status" NOT NULL DEFAULT 'NOT_STARTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "households_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_groceries" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" "unit" NOT NULL,

    CONSTRAINT "fixed_groceries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persons" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "person_role" NOT NULL DEFAULT 'OTHER',
    "hard_restrictions" JSONB NOT NULL DEFAULT '[]',
    "default_present" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "recipe_category" NOT NULL,
    "source" TEXT,
    "properties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "recipe_status" NOT NULL DEFAULT 'FOUND',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_ingredients" (
    "id" TEXT NOT NULL,
    "recipe_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" "unit" NOT NULL,

    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_variants" (
    "id" TEXT NOT NULL,
    "recipe_id" TEXT NOT NULL,
    "variant_type" "variant_type" NOT NULL,
    "ingredient_overrides" JSONB NOT NULL DEFAULT '{}',
    "context_fit" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipe_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_plans" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "week_start" DATE NOT NULL,
    "status" "meal_plan_status" NOT NULL DEFAULT 'CONCEPT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_plan_entries" (
    "id" TEXT NOT NULL,
    "meal_plan_id" TEXT NOT NULL,
    "day_of_week" "day_of_week" NOT NULL,
    "recipe_variant_id" TEXT NOT NULL,

    CONSTRAINT "meal_plan_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_suggestions" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "recipe_variant_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "confidence_level" "confidence_level" NOT NULL,
    "target_slot" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "unit" NOT NULL,
    "category" "ingredient_category" NOT NULL,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "ingredient_id" TEXT,
    "external_ref" TEXT,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "package_size" TEXT,
    "price" DECIMAL(10,2),
    "last_seen_available" TIMESTAMP(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopping_lists" (
    "id" TEXT NOT NULL,
    "meal_plan_id" TEXT NOT NULL,
    "status" "shopping_list_status" NOT NULL DEFAULT 'PREPARED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopping_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopping_list_lines" (
    "id" TEXT NOT NULL,
    "shopping_list_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "product_id" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" "unit" NOT NULL,
    "source" "line_source" NOT NULL,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "shopping_list_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_events" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "person_id" TEXT,
    "subject_type" "feedback_subject_type" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "event_type" "feedback_event_type" NOT NULL,
    "explicit" BOOLEAN NOT NULL DEFAULT false,
    "context" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preferences" (
    "id" TEXT NOT NULL,
    "owner_type" "preference_owner_type" NOT NULL,
    "owner_id" TEXT NOT NULL,
    "subject_type" "feedback_subject_type" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "stance" "stance" NOT NULL DEFAULT 'UNKNOWN',
    "source" "preference_source" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "persons_household_id_idx" ON "persons"("household_id");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_ingredients_recipe_id_ingredient_id_key" ON "recipe_ingredients"("recipe_id", "ingredient_id");

-- CreateIndex
CREATE INDEX "recipe_variants_recipe_id_idx" ON "recipe_variants"("recipe_id");

-- CreateIndex
CREATE UNIQUE INDEX "meal_plans_household_id_week_start_key" ON "meal_plans"("household_id", "week_start");

-- CreateIndex
CREATE UNIQUE INDEX "meal_plan_entries_meal_plan_id_day_of_week_key" ON "meal_plan_entries"("meal_plan_id", "day_of_week");

-- CreateIndex
CREATE INDEX "meal_suggestions_household_id_target_slot_idx" ON "meal_suggestions"("household_id", "target_slot");

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_name_key" ON "ingredients"("name");

-- CreateIndex
CREATE INDEX "products_ingredient_id_idx" ON "products"("ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "shopping_lists_meal_plan_id_key" ON "shopping_lists"("meal_plan_id");

-- CreateIndex
CREATE INDEX "shopping_list_lines_shopping_list_id_idx" ON "shopping_list_lines"("shopping_list_id");

-- CreateIndex
CREATE INDEX "feedback_events_household_id_subject_type_subject_id_idx" ON "feedback_events"("household_id", "subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "preferences_subject_type_subject_id_idx" ON "preferences"("subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "preferences_owner_type_owner_id_subject_type_subject_id_key" ON "preferences"("owner_type", "owner_id", "subject_type", "subject_id");

-- AddForeignKey
ALTER TABLE "fixed_groceries" ADD CONSTRAINT "fixed_groceries_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_groceries" ADD CONSTRAINT "fixed_groceries_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_variants" ADD CONSTRAINT "recipe_variants_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plan_entries" ADD CONSTRAINT "meal_plan_entries_meal_plan_id_fkey" FOREIGN KEY ("meal_plan_id") REFERENCES "meal_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plan_entries" ADD CONSTRAINT "meal_plan_entries_recipe_variant_id_fkey" FOREIGN KEY ("recipe_variant_id") REFERENCES "recipe_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_suggestions" ADD CONSTRAINT "meal_suggestions_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_suggestions" ADD CONSTRAINT "meal_suggestions_recipe_variant_id_fkey" FOREIGN KEY ("recipe_variant_id") REFERENCES "recipe_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_meal_plan_id_fkey" FOREIGN KEY ("meal_plan_id") REFERENCES "meal_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_list_lines" ADD CONSTRAINT "shopping_list_lines_shopping_list_id_fkey" FOREIGN KEY ("shopping_list_id") REFERENCES "shopping_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_list_lines" ADD CONSTRAINT "shopping_list_lines_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_list_lines" ADD CONSTRAINT "shopping_list_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_events" ADD CONSTRAINT "feedback_events_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_events" ADD CONSTRAINT "feedback_events_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
