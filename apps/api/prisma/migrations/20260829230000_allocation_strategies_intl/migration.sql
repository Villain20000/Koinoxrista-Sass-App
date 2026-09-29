-- P0-3: international allocation strategies (EU/NA). Additive.
-- AlterEnum
ALTER TYPE "AllocationStrategy" ADD VALUE 'SQUARE_METERS';
ALTER TYPE "AllocationStrategy" ADD VALUE 'SHARE_FRACTION';

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "squareMeters" DOUBLE PRECISION,
ADD COLUMN     "shareFraction" INTEGER;