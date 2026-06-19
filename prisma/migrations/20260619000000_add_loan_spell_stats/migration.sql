-- CreateTable
CREATE TABLE "LoanSpellStats" (
    "id" TEXT NOT NULL,
    "saveId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "transferId" TEXT,
    "loanClub" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "matches" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanSpellStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoanSpellStats_saveId_idx" ON "LoanSpellStats"("saveId");

-- CreateIndex
CREATE UNIQUE INDEX "LoanSpellStats_playerId_season_key" ON "LoanSpellStats"("playerId", "season");

-- AddForeignKey
ALTER TABLE "LoanSpellStats" ADD CONSTRAINT "LoanSpellStats_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanSpellStats" ADD CONSTRAINT "LoanSpellStats_saveId_fkey" FOREIGN KEY ("saveId") REFERENCES "Save"("id") ON DELETE CASCADE ON UPDATE CASCADE;
