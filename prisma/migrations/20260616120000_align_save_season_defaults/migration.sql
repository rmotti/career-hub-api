-- Align Save column defaults with createSave (which always sets 2025 / "2025/26").
-- The old 2026 / "2026/27" defaults never applied and were misleading in the schema.
ALTER TABLE "Save" ALTER COLUMN "currentYear" SET DEFAULT 2025;
ALTER TABLE "Save" ALTER COLUMN "currentSeason" SET DEFAULT '2025/26';
