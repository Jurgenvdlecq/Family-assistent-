-- AlterTable
ALTER TABLE "recipes" ADD COLUMN "instructions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE UNIQUE INDEX "recipes_title_key" ON "recipes"("title");
