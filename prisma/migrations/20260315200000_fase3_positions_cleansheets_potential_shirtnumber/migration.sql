-- U1: Expand Position enum with new values
ALTER TYPE "Position" ADD VALUE IF NOT EXISTS 'LD';
ALTER TYPE "Position" ADD VALUE IF NOT EXISTS 'LE';
ALTER TYPE "Position" ADD VALUE IF NOT EXISTS 'VOL';
ALTER TYPE "Position" ADD VALUE IF NOT EXISTS 'MC';
ALTER TYPE "Position" ADD VALUE IF NOT EXISTS 'ME';
ALTER TYPE "Position" ADD VALUE IF NOT EXISTS 'MD';
ALTER TYPE "Position" ADD VALUE IF NOT EXISTS 'PE';
ALTER TYPE "Position" ADD VALUE IF NOT EXISTS 'PD';
ALTER TYPE "Position" ADD VALUE IF NOT EXISTS 'SA';

-- U1: Migrate existing MEI data to MC (MEI agora representa meia-atacante; MC é o volante/meia central)
-- ⚠️ Jogadores com posição MEI foram migrados para MC — ajuste manualmente se necessário
UPDATE "Player" SET position = 'MC' WHERE position = 'MEI';

-- U7: Add cleanSheets to PlayerSeasonStats
ALTER TABLE "PlayerSeasonStats" ADD COLUMN "cleanSheets" INTEGER NOT NULL DEFAULT 0;

-- C1: Add potential to Player (nullable)
ALTER TABLE "Player" ADD COLUMN "potential" INTEGER;

-- C3: Add shirtNumber to Player (nullable)
ALTER TABLE "Player" ADD COLUMN "shirtNumber" INTEGER;
