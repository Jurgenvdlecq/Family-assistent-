-- AlterTable
ALTER TABLE "households" DROP COLUMN "access_code_hash",
ADD COLUMN     "password_hash" TEXT,
ADD COLUMN     "username" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "households_username_key" ON "households"("username");
