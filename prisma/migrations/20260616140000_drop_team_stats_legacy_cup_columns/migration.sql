-- Drop the legacy cup-result columns from TeamSeasonStats.
-- The current model records cup/european results as separate rows keyed by
-- competitionId + cupResult; europeanCupResult/nationalCupResult are dead weight
-- whose data was already migrated into the competition-based rows (prisma/migrate-data.ts).
-- No application code reads them (only the historical migrate-data.ts script did).
ALTER TABLE "TeamSeasonStats" DROP COLUMN "europeanCupResult";
ALTER TABLE "TeamSeasonStats" DROP COLUMN "nationalCupResult";
