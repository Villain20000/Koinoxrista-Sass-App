-- integrator: run the ALTER TYPE statement OUTSIDE any transaction block
-- (ALTER TYPE ... ADD VALUE cannot run inside a transaction block; split it
-- into its own migration or execute it standalone before the CREATE TABLEs).

-- ENUM ADDITION: enum AllocationStrategy += METERS (integrator)
ALTER TYPE "AllocationStrategy" ADD VALUE IF NOT EXISTS 'METERS';

-- CreateTable
CREATE TABLE "Meter" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT,

    CONSTRAINT "Meter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeterReading" (
    "id" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeterReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Meter_unitId_kind_key" ON "Meter"("unitId", "kind");

-- CreateIndex
CREATE INDEX "Meter_buildingId_idx" ON "Meter"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "MeterReading_meterId_period_key" ON "MeterReading"("meterId", "period");

-- CreateIndex
CREATE INDEX "MeterReading_meterId_idx" ON "MeterReading"("meterId");

-- AddForeignKey (CASCADE per fragment)
ALTER TABLE "Meter" ADD CONSTRAINT "Meter_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Meter" ADD CONSTRAINT "Meter_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (CASCADE per fragment)
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "Meter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "AgendaItem" (
    "id" TEXT NOT NULL,
    "voteId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgendaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "voteId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "present" BOOLEAN NOT NULL,
    "proxyUnitId" TEXT,
    "checkedInAt" TIMESTAMP(3),

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgendaItem_voteId_position_key" ON "AgendaItem"("voteId", "position");

-- CreateIndex
CREATE INDEX "AgendaItem_buildingId_idx" ON "AgendaItem"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_voteId_unitId_key" ON "Attendance"("voteId", "unitId");

-- CreateIndex
CREATE INDEX "Attendance_buildingId_idx" ON "Attendance"("buildingId");

-- AddForeignKey
ALTER TABLE "AgendaItem" ADD CONSTRAINT "AgendaItem_voteId_fkey" FOREIGN KEY ("voteId") REFERENCES "Vote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaItem" ADD CONSTRAINT "AgendaItem_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_voteId_fkey" FOREIGN KEY ("voteId") REFERENCES "Vote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "BankConnection" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "institutionName" TEXT NOT NULL,
    "iban" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'offline',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportedTransaction" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "bookedAt" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "remittanceInfo" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportedTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankConnection_buildingId_idx" ON "BankConnection"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "BankConnection_buildingId_iban_key" ON "BankConnection"("buildingId", "iban");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedTransaction_connectionId_externalId_key" ON "ImportedTransaction"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "ImportedTransaction_buildingId_idx" ON "ImportedTransaction"("buildingId");

-- AddForeignKey
ALTER TABLE "BankConnection" ADD CONSTRAINT "BankConnection_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportedTransaction" ADD CONSTRAINT "ImportedTransaction_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BankConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Building announcements / newsfeed (Phase: announcements)

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "audience" TEXT NOT NULL DEFAULT 'ALL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementComment" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Announcement_buildingId_pinned_createdAt_idx" ON "Announcement"("buildingId", "pinned", "createdAt");

-- CreateIndex
CREATE INDEX "Announcement_authorId_idx" ON "Announcement"("authorId");

-- CreateIndex
CREATE INDEX "AnnouncementComment_announcementId_createdAt_idx" ON "AnnouncementComment"("announcementId", "createdAt");

-- CreateIndex
CREATE INDEX "AnnouncementComment_authorId_idx" ON "AnnouncementComment"("authorId");

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementComment" ADD CONSTRAINT "AnnouncementComment_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementComment" ADD CONSTRAINT "AnnouncementComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Τμηματοποίηση οφειλής — installment plans for a unit's arrears

-- CreateTable
CREATE TABLE "PaymentPlan" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "installmentCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "PaymentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentPlanInstallment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "PaymentPlanInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentPlan_buildingId_status_idx" ON "PaymentPlan"("buildingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentPlanInstallment_planId_seq_key" ON "PaymentPlanInstallment"("planId", "seq");

-- AddForeignKey
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPlanInstallment" ADD CONSTRAINT "PaymentPlanInstallment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PaymentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- White-label branding per building (Premium tier)

-- CreateTable
CREATE TABLE "BuildingBranding" (
    "buildingId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#1e40af',
    "accentColor" TEXT NOT NULL DEFAULT '#0ea5e9',
    "orgName" TEXT,
    "footerText" TEXT,
    "customDomain" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuildingBranding_pkey" PRIMARY KEY ("buildingId")
);

-- CreateIndex
CREATE UNIQUE INDEX "BuildingBranding_customDomain_key" ON "BuildingBranding"("customDomain");

-- AddForeignKey
ALTER TABLE "BuildingBranding" ADD CONSTRAINT "BuildingBranding_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;
