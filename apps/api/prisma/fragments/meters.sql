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
