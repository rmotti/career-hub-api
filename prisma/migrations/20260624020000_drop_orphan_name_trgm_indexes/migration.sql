-- Remove os índices trigram sobre as colunas CRUAS (name/longName), criados na migração
-- 20260624000000. Ficaram órfãos quando a busca passou a usar immutable_unaccent(...) ILIKE
-- (migração 20260624010000): a query só casa com o índice cuja expressão bate exatamente,
-- então estes nunca mais são escolhidos pelo planner — só ocupavam disco.
--
-- Em prod já foram dropados manualmente; aqui o IF EXISTS torna isto idempotente (no-op em
-- prod) e, principalmente, alinha o histórico de migrações ao schema real — sem isso, uma
-- recriação do banco a partir das migrações traria os índices órfãos de volta (drift).

DROP INDEX IF EXISTS "Fc26Player_name_trgm_idx";
DROP INDEX IF EXISTS "Fc26Player_longName_trgm_idx";
