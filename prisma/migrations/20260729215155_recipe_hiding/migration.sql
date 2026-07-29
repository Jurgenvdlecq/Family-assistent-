-- AlterEnum
ALTER TYPE "feedback_event_type" ADD VALUE 'RESTORED';

-- AlterTable
ALTER TABLE "preferences" ADD COLUMN     "hidden_at" TIMESTAMP(3);
