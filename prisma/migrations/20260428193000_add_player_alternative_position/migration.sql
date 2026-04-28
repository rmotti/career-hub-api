ALTER TABLE "Player"
ADD COLUMN IF NOT EXISTS "alternativePosition" JSONB NOT NULL DEFAULT '{"positions":[]}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Player_alternativePosition_shape_check'
      AND conrelid = '"Player"'::regclass
  ) THEN
    ALTER TABLE "Player"
    ADD CONSTRAINT "Player_alternativePosition_shape_check"
    CHECK (
      jsonb_typeof("alternativePosition") = 'object'
      AND "alternativePosition" ? 'positions'
      AND jsonb_typeof("alternativePosition"->'positions') = 'array'
    );
  END IF;
END $$;
