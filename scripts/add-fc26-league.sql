ALTER TABLE "Fc26Player" ADD COLUMN IF NOT EXISTS "league" TEXT;
CREATE INDEX IF NOT EXISTS "Fc26Player_nation_idx"  ON "Fc26Player"("nation");
CREATE INDEX IF NOT EXISTS "Fc26Player_league_idx"  ON "Fc26Player"("league");
