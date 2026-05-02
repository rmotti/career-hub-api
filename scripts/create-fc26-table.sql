CREATE TABLE IF NOT EXISTS "Fc26Player" (
  "id"          SERIAL          NOT NULL,
  "sofifaId"    INTEGER         NOT NULL,
  "name"        TEXT            NOT NULL,
  "positions"   TEXT[]          NOT NULL,
  "age"         INTEGER         NOT NULL,
  "ovr"         INTEGER         NOT NULL,
  "potential"   INTEGER         NOT NULL,
  "marketValue" DOUBLE PRECISION,
  "nation"      TEXT,
  "club"        TEXT,
  "wage"        DOUBLE PRECISION,
  CONSTRAINT "Fc26Player_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Fc26Player_sofifaId_key" ON "Fc26Player"("sofifaId");
CREATE INDEX IF NOT EXISTS "Fc26Player_ovr_idx"       ON "Fc26Player"("ovr");
CREATE INDEX IF NOT EXISTS "Fc26Player_potential_idx"  ON "Fc26Player"("potential");
CREATE INDEX IF NOT EXISTS "Fc26Player_age_idx"        ON "Fc26Player"("age");
