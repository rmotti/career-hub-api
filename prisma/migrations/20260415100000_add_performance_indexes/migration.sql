-- ClubStint: filtragem frequente por saveId e por saveId+isCurrent
CREATE INDEX IF NOT EXISTS "ClubStint_saveId_idx" ON "ClubStint"("saveId");
CREATE INDEX IF NOT EXISTS "ClubStint_saveId_isCurrent_idx" ON "ClubStint"("saveId", "isCurrent");

-- Player: filtragem frequente por saveId e por elenco ativo
CREATE INDEX IF NOT EXISTS "Player_saveId_idx" ON "Player"("saveId");
CREATE INDEX IF NOT EXISTS "Player_saveId_activeClubStintId_idx" ON "Player"("saveId", "activeClubStintId");

-- PlayerOvrHistory: busca do OVR mais recente por jogador
CREATE INDEX IF NOT EXISTS "PlayerOvrHistory_playerId_createdAt_idx" ON "PlayerOvrHistory"("playerId", "createdAt" DESC);

-- PlayerSeasonStats: listagem de stats por stint e temporada
CREATE INDEX IF NOT EXISTS "PlayerSeasonStats_clubStintId_season_idx" ON "PlayerSeasonStats"("clubStintId", "season");

-- Transfer: listagem e filtro por temporada
CREATE INDEX IF NOT EXISTS "Transfer_saveId_idx" ON "Transfer"("saveId");
CREATE INDEX IF NOT EXISTS "Transfer_saveId_season_idx" ON "Transfer"("saveId", "season");
