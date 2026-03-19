CREATE TABLE "PlayerOvrHistory" (
  "id"          TEXT             NOT NULL,
  "playerId"    TEXT             NOT NULL,
  "season"      TEXT             NOT NULL,
  "ovr"         INTEGER          NOT NULL,
  "marketValue" DOUBLE PRECISION,
  "createdAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlayerOvrHistory_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PlayerOvrHistory"
  ADD CONSTRAINT "PlayerOvrHistory_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "Player"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
