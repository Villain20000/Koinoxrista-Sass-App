-- Per-expense payer (ένοικος vs ιδιοκτήτης) and one invoice per payer.
CREATE TYPE "ChargePayer" AS ENUM ('OCCUPANT', 'OWNER');

ALTER TABLE "Expense" ADD COLUMN "chargeTo" "ChargePayer" NOT NULL DEFAULT 'OCCUPANT';
ALTER TABLE "ExpenseCategory" ADD COLUMN "defaultChargeTo" "ChargePayer" NOT NULL DEFAULT 'OCCUPANT';
ALTER TABLE "Invoice" ADD COLUMN "payer" "ChargePayer" NOT NULL DEFAULT 'OCCUPANT';

DROP INDEX "Invoice_unitId_periodYearMonth_key";
CREATE UNIQUE INDEX "Invoice_unitId_periodYearMonth_payer_key" ON "Invoice"("unitId", "periodYearMonth", "payer");
