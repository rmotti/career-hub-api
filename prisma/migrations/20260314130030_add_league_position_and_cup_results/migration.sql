-- CreateEnum
CREATE TYPE "CupResult" AS ENUM ('Campeao', 'Final', 'Semifinal', 'Quartas', 'OitavasOuFaseDeGrupos', 'Eliminado', 'NaoParticipou');

-- AlterTable
ALTER TABLE "TeamSeasonStats" ADD COLUMN     "europeanCupResult" "CupResult" NOT NULL DEFAULT 'NaoParticipou',
ADD COLUMN     "leaguePosition" INTEGER,
ADD COLUMN     "nationalCupResult" "CupResult" NOT NULL DEFAULT 'NaoParticipou';
