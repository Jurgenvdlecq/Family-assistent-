-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN     "restriction_tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
