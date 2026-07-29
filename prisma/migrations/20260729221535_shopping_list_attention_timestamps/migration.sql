-- AlterTable
ALTER TABLE "shopping_lists" ADD COLUMN     "order_confirmed_at" TIMESTAMP(3),
ADD COLUMN     "review_flagged_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_at" TIMESTAMP(3);
