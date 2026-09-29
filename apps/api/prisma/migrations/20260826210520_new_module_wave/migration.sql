/*
  Warnings:

  - Changed the type of `role` on the `Invite` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropForeignKey
ALTER TABLE "Invite" DROP CONSTRAINT "Invite_buildingId_fkey";

-- AlterTable
ALTER TABLE "Invite" DROP COLUMN "role",
ADD COLUMN     "role" "Role" NOT NULL;

-- AlterTable
ALTER TABLE "Ownership" ADD COLUMN     "occupantType" TEXT NOT NULL DEFAULT 'OWNER',
ADD COLUMN     "residentRole" TEXT,
ADD COLUMN     "votingEligible" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "TreasuryAccount" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "iban" TEXT,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreasuryAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasuryEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "receiptUrl" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreasuryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReserveFund" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "targetCents" INTEGER NOT NULL DEFAULT 0,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReserveFund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReserveContribution" (
    "id" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "levyId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReserveContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReserveDrawdown" (
    "id" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "expenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReserveDrawdown_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtraordinaryLevy" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "strategy" "AllocationStrategy" NOT NULL,
    "status" TEXT NOT NULL,
    "voteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtraordinaryLevy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevyShare" (
    "id" TEXT NOT NULL,
    "levyId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LevyShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VotingEligibilityRule" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "allowedTypes" TEXT[],
    "requiresMillimes" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VotingEligibilityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoice" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "issuerName" TEXT NOT NULL,
    "issuerAfm" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "netCents" INTEGER NOT NULL,
    "vatCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "mydataMark" TEXT,
    "classification" TEXT,
    "status" TEXT NOT NULL,
    "rawJson" JSONB,
    "pdfUrl" TEXT,
    "expenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildingAsset" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "location" TEXT,
    "installedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuildingAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceSchedule" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "intervalMonths" INTEGER NOT NULL,
    "lastDoneAt" TIMESTAMP(3),
    "nextDueAt" TIMESTAMP(3) NOT NULL,
    "autoCreateJob" BOOLEAN NOT NULL DEFAULT true,
    "expenseCategoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalCase" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "invoiceIds" TEXT[],
    "lawyerName" TEXT,
    "lawyerEmail" TEXT,
    "notes" TEXT,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalEvent" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TreasuryAccount_buildingId_idx" ON "TreasuryAccount"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryAccount_buildingId_name_key" ON "TreasuryAccount"("buildingId", "name");

-- CreateIndex
CREATE INDEX "TreasuryEntry_buildingId_createdAt_idx" ON "TreasuryEntry"("buildingId", "createdAt");

-- CreateIndex
CREATE INDEX "TreasuryEntry_accountId_idx" ON "TreasuryEntry"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ReserveFund_buildingId_key" ON "ReserveFund"("buildingId");

-- CreateIndex
CREATE INDEX "ReserveContribution_buildingId_createdAt_idx" ON "ReserveContribution"("buildingId", "createdAt");

-- CreateIndex
CREATE INDEX "ReserveDrawdown_buildingId_idx" ON "ReserveDrawdown"("buildingId");

-- CreateIndex
CREATE INDEX "ExtraordinaryLevy_buildingId_status_idx" ON "ExtraordinaryLevy"("buildingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LevyShare_levyId_unitId_key" ON "LevyShare"("levyId", "unitId");

-- CreateIndex
CREATE INDEX "VotingEligibilityRule_buildingId_idx" ON "VotingEligibilityRule"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "VotingEligibilityRule_buildingId_category_key" ON "VotingEligibilityRule"("buildingId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_mydataMark_key" ON "SupplierInvoice"("mydataMark");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_expenseId_key" ON "SupplierInvoice"("expenseId");

-- CreateIndex
CREATE INDEX "SupplierInvoice_buildingId_status_idx" ON "SupplierInvoice"("buildingId", "status");

-- CreateIndex
CREATE INDEX "SupplierInvoice_buildingId_issueDate_idx" ON "SupplierInvoice"("buildingId", "issueDate");

-- CreateIndex
CREATE INDEX "BuildingAsset_buildingId_category_idx" ON "BuildingAsset"("buildingId", "category");

-- CreateIndex
CREATE INDEX "MaintenanceSchedule_buildingId_nextDueAt_idx" ON "MaintenanceSchedule"("buildingId", "nextDueAt");

-- CreateIndex
CREATE INDEX "MaintenanceSchedule_assetId_idx" ON "MaintenanceSchedule"("assetId");

-- CreateIndex
CREATE INDEX "LegalCase_buildingId_stage_idx" ON "LegalCase"("buildingId", "stage");

-- CreateIndex
CREATE INDEX "LegalCase_unitId_idx" ON "LegalCase"("unitId");

-- CreateIndex
CREATE INDEX "LegalEvent_caseId_createdAt_idx" ON "LegalEvent"("caseId", "createdAt");

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryAccount" ADD CONSTRAINT "TreasuryAccount_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryEntry" ADD CONSTRAINT "TreasuryEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TreasuryAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryEntry" ADD CONSTRAINT "TreasuryEntry_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReserveFund" ADD CONSTRAINT "ReserveFund_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReserveContribution" ADD CONSTRAINT "ReserveContribution_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "ReserveFund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReserveContribution" ADD CONSTRAINT "ReserveContribution_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReserveDrawdown" ADD CONSTRAINT "ReserveDrawdown_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "ReserveFund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReserveDrawdown" ADD CONSTRAINT "ReserveDrawdown_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraordinaryLevy" ADD CONSTRAINT "ExtraordinaryLevy_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevyShare" ADD CONSTRAINT "LevyShare_levyId_fkey" FOREIGN KEY ("levyId") REFERENCES "ExtraordinaryLevy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevyShare" ADD CONSTRAINT "LevyShare_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VotingEligibilityRule" ADD CONSTRAINT "VotingEligibilityRule_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildingAsset" ADD CONSTRAINT "BuildingAsset_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "BuildingAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalCase" ADD CONSTRAINT "LegalCase_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalCase" ADD CONSTRAINT "LegalCase_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalEvent" ADD CONSTRAINT "LegalEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LegalCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalEvent" ADD CONSTRAINT "LegalEvent_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;
