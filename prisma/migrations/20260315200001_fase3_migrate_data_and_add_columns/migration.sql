-- U1: Migrate existing MEI data to MC
-- ⚠️ Jogadores com posição MEI foram migrados para MC — ajuste manualmente se necessário
UPDATE "Player" SET position = 'MC' WHERE position = 'MEI';

-- U7: Add cleanSheets to PlayerSeasonStats
ALTER TABLE "PlayerSeasonStats" ADD COLUMN "cleanSheets" INTEGER NOT NULL DEFAULT 0;

-- C1: Add potential to Player (nullable)
ALTER TABLE "Player" ADD COLUMN "potential" INTEGER;

-- C3: Add shirtNumber to Player (nullable)
ALTER TABLE "Player" ADD COLUMN "shirtNumber" INTEGER;
