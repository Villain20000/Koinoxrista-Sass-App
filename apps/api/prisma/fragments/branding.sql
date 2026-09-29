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
