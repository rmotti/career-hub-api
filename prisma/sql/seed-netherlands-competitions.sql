-- Adiciona as competições da Holanda (liga + copa + supercopa).
-- Idempotente: Competition.name é UNIQUE, então ON CONFLICT evita duplicar.
INSERT INTO "Competition" ("id", "name", "type", "country")
VALUES
  ((gen_random_uuid())::text, 'Eredivisie',           'League',      'Netherlands'),
  ((gen_random_uuid())::text, 'TOTO KNVB Beker',      'NationalCup', 'Netherlands'),
  ((gen_random_uuid())::text, 'Johan Cruijff Schaal', 'SuperCup',    'Netherlands')
ON CONFLICT ("name") DO NOTHING;
