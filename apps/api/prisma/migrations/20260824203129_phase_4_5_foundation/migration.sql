/*
  Warnings:

  - The `tier` column on the `Subscription` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `Subscription` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `fileName` to the `Document` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sizeBytes` to the `Document` table without a default value. This is not possible if the table is not empty.
  - Added the required column `pricePerUnitCents` to the `Subscription` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Subscription` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('BASIC', 'PRO', 'PREMIUM');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "MyDataStatus" AS ENUM ('PENDING', 'SUBMITTED', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "GdprRequestType" AS ENUM ('EXPORT', 'DELETE');

-- CreateEnum
CREATE TYPE "GdprRequestStatus" AS ENUM ('PENDING', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentOrderState" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AllocationStrategy" ADD VALUE 'RADIATORS';
ALTER TYPE "AllocationStrategy" ADD VALUE 'ELEVATOR_FLOORS';

-- AlterTable
ALTER TABLE "Bid" ADD COLUMN     "ratingStars" INTEGER;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "fileName" TEXT NOT NULL,
ADD COLUMN     "sizeBytes" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "cancelAt" TIMESTAMP(3),
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "currentPeriodStart" TIMESTAMP(3),
ADD COLUMN     "pricePerUnitCents" INTEGER NOT NULL,
ADD COLUMN     "trialEndsAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
DROP COLUMN "tier",
ADD COLUMN     "tier" "SubscriptionTier" NOT NULL DEFAULT 'BASIC',
DROP COLUMN "status",
ADD COLUMN     "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING';

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "radiatorCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Vote" ADD COLUMN     "description" TEXT;

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MyDataInvoice" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "mark" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "seqNo" INTEGER NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "paymentMethodCode" TEXT NOT NULL,
    "classificationCategory" TEXT NOT NULL,
    "classificationType" TEXT NOT NULL,
    "netAmountCents" INTEGER NOT NULL,
    "vatAmountCents" INTEGER NOT NULL,
    "status" "MyDataStatus" NOT NULL DEFAULT 'PENDING',
    "responseRaw" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MyDataInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentOrder" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "orderCode" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "PaymentOrderState" NOT NULL DEFAULT 'PENDING',
    "checkoutUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GdprRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "buildingId" TEXT,
    "type" "GdprRequestType" NOT NULL,
    "status" "GdprRequestStatus" NOT NULL DEFAULT 'PENDING',
    "resultKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GdprRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT,
    "actorId" TEXT,
    "actorRole" "Role",
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Membership_buildingId_idx" ON "Membership"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_buildingId_key" ON "Membership"("userId", "buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_buildingId_idx" ON "ApiKey"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "MyDataInvoice_invoiceId_key" ON "MyDataInvoice"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "MyDataInvoice_mark_key" ON "MyDataInvoice"("mark");

-- CreateIndex
CREATE INDEX "MyDataInvoice_buildingId_idx" ON "MyDataInvoice"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_orderCode_key" ON "PaymentOrder"("orderCode");

-- CreateIndex
CREATE INDEX "PaymentOrder_invoiceId_idx" ON "PaymentOrder"("invoiceId");

-- CreateIndex
CREATE INDEX "GdprRequest_userId_idx" ON "GdprRequest"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_buildingId_createdAt_idx" ON "AuditLog"("buildingId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MyDataInvoice" ADD CONSTRAINT "MyDataInvoice_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MyDataInvoice" ADD CONSTRAINT "MyDataInvoice_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GdprRequest" ADD CONSTRAINT "GdprRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
