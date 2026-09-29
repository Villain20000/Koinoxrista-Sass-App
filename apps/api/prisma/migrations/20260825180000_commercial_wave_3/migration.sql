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

-- Partner referrals & revenue-share tracker (Phase: partners)

-- CreateTable
CREATE TABLE "PartnerLead" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "partnerName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "expectedCommissionCents" INTEGER NOT NULL,
    "actualCommissionCents" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerLead_buildingId_status_idx" ON "PartnerLead"("buildingId", "status");

-- AddForeignKey
ALTER TABLE "PartnerLead" ADD CONSTRAINT "PartnerLead_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerLead" ADD CONSTRAINT "PartnerLead_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Session/device management (matches fragments/sessions.prisma).
-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RefreshSession_userId_idx" ON "RefreshSession"("userId");
CREATE INDEX "RefreshSession_tokenHash_idx" ON "RefreshSession"("tokenHash");

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
