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
