-- Typeahead na aba Search: GET /fc26-players?name=... usa ILIKE '%termo%' (Prisma
-- contains + mode: insensitive) em name e longName. Sem índice isso é seq scan; o
-- índice trigram GIN torna a busca por substring case-insensitive indexada.

-- Extensão trigram (idempotente; precisa de privilégio de criação de extensão no Neon).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- gin_trgm_ops casa com ILIKE/contains em qualquer posição da string.
CREATE INDEX IF NOT EXISTS "Fc26Player_name_trgm_idx"
  ON "Fc26Player" USING GIN ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Fc26Player_longName_trgm_idx"
  ON "Fc26Player" USING GIN ("longName" gin_trgm_ops);
