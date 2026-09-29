-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "reportedById" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'ADMIN_RFP';

-- AlterTable
ALTER TABLE "ProviderProfile" ADD COLUMN     "bio" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "hourlyRateCents" INTEGER;

-- CreateIndex
CREATE INDEX "Job_reportedById_idx" ON "Job"("reportedById");

-- CreateIndex
CREATE INDEX "ProviderProfile_city_idx" ON "ProviderProfile"("city");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
