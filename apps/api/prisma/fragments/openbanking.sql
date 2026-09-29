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
