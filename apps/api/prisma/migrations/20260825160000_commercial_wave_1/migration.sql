-- integrator: ensure this migration is not wrapped in a transaction
-- (ALTER TYPE ... ADD VALUE cannot run inside a transaction block).
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ACCOUNTANT';

-- CreateTable
CREATE TABLE "AccountantAccess" (
    "id" TEXT NOT NULL,
    "accountantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountantAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountantAccess_accountantId_buildingId_key" ON "AccountantAccess"("accountantId", "buildingId");

-- AddForeignKeys (User / Building, CASCADE per fragment)
ALTER TABLE "AccountantAccess" ADD CONSTRAINT "AccountantAccess_accountantId_fkey" FOREIGN KEY ("accountantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountantAccess" ADD CONSTRAINT "AccountantAccess_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountantAccess" ADD CONSTRAINT "AccountantAccess_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ρόπα late-payment surcharges (Phase: late fees)

-- CreateTable
CREATE TABLE "LateFeeSetting" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "graceDays" INTEGER NOT NULL DEFAULT 5,
    "mode" TEXT NOT NULL DEFAULT 'FLAT',
    "dailyFlatCents" INTEGER NOT NULL DEFAULT 0,
    "dailyBps" INTEGER NOT NULL DEFAULT 0,
    "capCents" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LateFeeSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LateFeeCharge" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "daysLate" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "waivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LateFeeCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LateFeeSetting_buildingId_key" ON "LateFeeSetting"("buildingId");

-- CreateIndex
CREATE INDEX "LateFeeSetting_buildingId_idx" ON "LateFeeSetting"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "LateFeeCharge_unitId_month_key" ON "LateFeeCharge"("unitId", "month");

-- CreateIndex
CREATE INDEX "LateFeeCharge_buildingId_idx" ON "LateFeeCharge"("buildingId");

-- AddForeignKey
ALTER TABLE "LateFeeSetting" ADD CONSTRAINT "LateFeeSetting_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LateFeeCharge" ADD CONSTRAINT "LateFeeCharge_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LateFeeCharge" ADD CONSTRAINT "LateFeeCharge_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LateFeeCharge" ADD CONSTRAINT "LateFeeCharge_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "PlatformInvoice" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "number" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "PlatformInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformInvoice_number_key" ON "PlatformInvoice"("number");

-- CreateIndex
CREATE INDEX "PlatformInvoice_buildingId_idx" ON "PlatformInvoice"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformInvoice_subscriptionId_period_key" ON "PlatformInvoice"("subscriptionId", "period");

-- AddForeignKey
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- TOTP two-factor authentication (matches fragments/two-factor.prisma).
ALTER TABLE "User" ADD COLUMN "twoFactorSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TwoFactorRecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TwoFactorRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TwoFactorRecoveryCode_userId_idx" ON "TwoFactorRecoveryCode"("userId");

-- AddForeignKey
ALTER TABLE "TwoFactorRecoveryCode" ADD CONSTRAINT "TwoFactorRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
