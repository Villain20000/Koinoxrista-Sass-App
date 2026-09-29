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
