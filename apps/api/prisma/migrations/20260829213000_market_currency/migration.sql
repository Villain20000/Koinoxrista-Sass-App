-- Additive internationalization: market profile + currency per building.
-- Defaults keep every existing building on the Greek path ("GR" / "EUR").
-- AlterTable
ALTER TABLE "Building" ADD COLUMN     "market" TEXT NOT NULL DEFAULT 'GR',
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'EUR';