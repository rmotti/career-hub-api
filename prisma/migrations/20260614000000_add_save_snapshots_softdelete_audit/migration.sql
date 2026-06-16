-- AlterTable: soft-delete marker on Save (nullable, non-destructive)
ALTER TABLE "Save" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Save_userId_deletedAt_idx" ON "Save"("userId", "deletedAt");

-- CreateTable: full JSON snapshot of a save tree, taken before irreversible ops
CREATE TABLE "SaveSnapshot" (
    "id" TEXT NOT NULL,
    "saveId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaveSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SaveSnapshot_saveId_createdAt_idx" ON "SaveSnapshot"("saveId", "createdAt" DESC);

ALTER TABLE "SaveSnapshot"
ADD CONSTRAINT "SaveSnapshot_saveId_fkey"
FOREIGN KEY ("saveId") REFERENCES "Save"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: audit trail for irreversible mutations (no FK to Save: survives purge)
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "saveId" TEXT,
    "action" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt" DESC);
CREATE INDEX "AuditLog_saveId_idx" ON "AuditLog"("saveId");
