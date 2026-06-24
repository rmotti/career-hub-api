-- Evolui a busca por nome (typeahead) para ignorar TAMBÉM acento, não só caixa:
-- unaccent("name") ILIKE unaccent('%termo%') — "vinicius" acha "Vinícius", "mbappe" acha
-- "Mbappé". A migração anterior (20260624000000) já criou pg_trgm + índices trigram sobre
-- name/longName crus; aqui adicionamos unaccent e índices sobre a expressão sem acento.

-- Extensão unaccent (idempotente; precisa de privilégio de criação de extensão).
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() não é IMMUTABLE por padrão (depende do dicionário), então não pode ser usada
-- direto num índice de expressão. Wrapper IMMUTABLE fixando o dicionário público padrão.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;

-- gin_trgm_ops sobre o texto já sem acento: casa com immutable_unaccent(col) ILIKE em
-- qualquer posição. A expressão do índice tem que bater EXATAMENTE com a usada na query.
CREATE INDEX IF NOT EXISTS "Fc26Player_name_unaccent_trgm_idx"
  ON "Fc26Player" USING GIN (immutable_unaccent("name") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Fc26Player_longName_unaccent_trgm_idx"
  ON "Fc26Player" USING GIN (immutable_unaccent(COALESCE("longName", '')) gin_trgm_ops);
