-- Marketplace monetization: job commissions + featured provider placements

-- CreateTable
CREATE TABLE "JobCommission" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "baseCents" INTEGER NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DUE',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobCommission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeaturedSlot" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "trade" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeaturedSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobCommission_jobId_key" ON "JobCommission"("jobId");

-- CreateIndex
CREATE INDEX "JobCommission_buildingId_createdAt_idx" ON "JobCommission"("buildingId", "createdAt");

-- CreateIndex
CREATE INDEX "FeaturedSlot_buildingId_endsAt_idx" ON "FeaturedSlot"("buildingId", "endsAt");

-- AddForeignKey
ALTER TABLE "JobCommission" ADD CONSTRAINT "JobCommission_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCommission" ADD CONSTRAINT "JobCommission_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCommission" ADD CONSTRAINT "JobCommission_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturedSlot" ADD CONSTRAINT "FeaturedSlot_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturedSlot" ADD CONSTRAINT "FeaturedSlot_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
