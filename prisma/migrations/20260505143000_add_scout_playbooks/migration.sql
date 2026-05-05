CREATE TABLE "ScoutPlaybook" (
    "id" TEXT NOT NULL,
    "saveId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weights" JSONB NOT NULL,
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoutPlaybook_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScoutPlaybook_saveId_name_key" ON "ScoutPlaybook"("saveId", "name");
CREATE INDEX "ScoutPlaybook_saveId_idx" ON "ScoutPlaybook"("saveId");
CREATE INDEX "ScoutPlaybook_saveId_isDefault_idx" ON "ScoutPlaybook"("saveId", "isDefault");

ALTER TABLE "ScoutPlaybook"
ADD CONSTRAINT "ScoutPlaybook_saveId_fkey"
FOREIGN KEY ("saveId") REFERENCES "Save"("id") ON DELETE CASCADE ON UPDATE CASCADE;
