-- CreateEnum
CREATE TYPE "ShortlistPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "ShortlistItem" (
    "id" TEXT NOT NULL,
    "saveId" TEXT NOT NULL,
    "fc26PlayerId" INTEGER NOT NULL,
    "notes" TEXT,
    "priority" "ShortlistPriority",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortlistItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShortlistItem_saveId_fc26PlayerId_key" ON "ShortlistItem"("saveId", "fc26PlayerId");
CREATE INDEX "ShortlistItem_saveId_idx" ON "ShortlistItem"("saveId");

ALTER TABLE "ShortlistItem"
ADD CONSTRAINT "ShortlistItem_saveId_fkey"
FOREIGN KEY ("saveId") REFERENCES "Save"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ShortlistItem"
ADD CONSTRAINT "ShortlistItem_fc26PlayerId_fkey"
FOREIGN KEY ("fc26PlayerId") REFERENCES "Fc26Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL,
    "saveId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SavedSearch_saveId_name_key" ON "SavedSearch"("saveId", "name");
CREATE INDEX "SavedSearch_saveId_idx" ON "SavedSearch"("saveId");

ALTER TABLE "SavedSearch"
ADD CONSTRAINT "SavedSearch_saveId_fkey"
FOREIGN KEY ("saveId") REFERENCES "Save"("id") ON DELETE CASCADE ON UPDATE CASCADE;
