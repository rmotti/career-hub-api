-- AlterTable: TeamSeasonStats — remove possession column
ALTER TABLE "TeamSeasonStats" DROP COLUMN IF EXISTS "possession";

-- AlterEnum: TransferType — add loan values
ALTER TYPE "TransferType" ADD VALUE IF NOT EXISTS 'emprestimo_entrada';
ALTER TYPE "TransferType" ADD VALUE IF NOT EXISTS 'emprestimo_saida';