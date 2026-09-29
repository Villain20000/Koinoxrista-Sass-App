-- Συστάσεις / referral program (Phase: referrals)

-- CreateTable
CREATE TABLE "ReferralCredit" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "sourceBuildingId" TEXT,
    "code" TEXT NOT NULL,
    "months" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedPeriod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralCredit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReferralCredit_buildingId_usedAt_idx" ON "ReferralCredit"("buildingId", "usedAt");

-- AddForeignKey
ALTER TABLE "ReferralCredit" ADD CONSTRAINT "ReferralCredit_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Building.referralCode String? @unique (orchestrator merges into schema.prisma)
ALTER TABLE "Building" ADD COLUMN "referralCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Building_referralCode_key" ON "Building"("referralCode");
