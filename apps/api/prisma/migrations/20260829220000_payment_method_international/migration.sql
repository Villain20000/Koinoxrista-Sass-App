-- Additive: international payment rails for P0-2 (BR PIX, US ACH, MX SPEI,
-- EU SEPA, CA Interac). Greek flows only ever write CARD | IRIS.
-- Postgres 12+: multiple ADD VALUE statements are allowed in one migration.
ALTER TYPE "PaymentMethod" ADD VALUE 'PIX';
ALTER TYPE "PaymentMethod" ADD VALUE 'ACH';
ALTER TYPE "PaymentMethod" ADD VALUE 'SPEI';
ALTER TYPE "PaymentMethod" ADD VALUE 'SEPA_DD';
ALTER TYPE "PaymentMethod" ADD VALUE 'INTERAC';