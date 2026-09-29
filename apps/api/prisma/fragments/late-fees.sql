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
