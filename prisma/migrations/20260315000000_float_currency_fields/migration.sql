-- AlterTable: Player — salary and marketValue from TEXT to DOUBLE PRECISION
ALTER TABLE "Player" DROP COLUMN "salary";
ALTER TABLE "Player" ADD COLUMN "salary" DOUBLE PRECISION;
ALTER TABLE "Player" DROP COLUMN "marketValue";
ALTER TABLE "Player" ADD COLUMN "marketValue" DOUBLE PRECISION;

-- AlterTable: Save — budget and balance from TEXT to DOUBLE PRECISION
ALTER TABLE "Save" DROP COLUMN "budget";
ALTER TABLE "Save" ADD COLUMN "budget" DOUBLE PRECISION;
ALTER TABLE "Save" DROP COLUMN "balance";
ALTER TABLE "Save" ADD COLUMN "balance" DOUBLE PRECISION;

-- AlterTable: Transfer — fee from TEXT to DOUBLE PRECISION
ALTER TABLE "Transfer" DROP COLUMN "fee";
ALTER TABLE "Transfer" ADD COLUMN "fee" DOUBLE PRECISION;
