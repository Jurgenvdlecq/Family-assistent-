-- AlterTable
ALTER TABLE "households" ADD COLUMN     "hard_restrictions" JSONB NOT NULL DEFAULT '[]';
