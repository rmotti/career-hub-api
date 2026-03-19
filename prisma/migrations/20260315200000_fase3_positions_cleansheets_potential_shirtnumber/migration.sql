-- U1: Expand Position enum with new values
-- Must be in its own migration (PostgreSQL requires new enum values to be committed
-- before they can be referenced in DML statements like UPDATE)
ALTER TYPE "Position" ADD VALUE IF NOT EXISTS 'LD';
ALTER TYPE "Position" ADD VALUE IF NOT EXISTS 'LE';
ALTER TYPE "Position" ADD VALUE IF NOT EXISTS 'VOL';
ALTER TYPE "Position" ADD VALUE IF NOT EXISTS 'MC';
ALTER TYPE "Position" ADD VALUE IF NOT EXISTS 'ME';
ALTER TYPE "Position" ADD VALUE IF NOT EXISTS 'MD';
ALTER TYPE "Position" ADD VALUE IF NOT EXISTS 'PE';
ALTER TYPE "Position" ADD VALUE IF NOT EXISTS 'PD';
ALTER TYPE "Position" ADD VALUE IF NOT EXISTS 'SA';
