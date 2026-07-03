-- Step 2 of 2 (csv-import): provenance table, import link columns, the
-- four-source CHECK rewrite, and the partial unique dedup index.

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PROCESSING', 'COMPLETED');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "dedupHash" CHAR(64),
ADD COLUMN     "importRunId" UUID;

-- CreateTable
CREATE TABLE "import_runs" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PROCESSING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "fileHash" CHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_runs_userId_idx" ON "import_runs"("userId");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_importRunId_fkey" FOREIGN KEY ("importRunId") REFERENCES "import_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rewrite the source-aware link CHECK to cover a fourth source (IMPORTED).
-- Manual addition — Prisma cannot model CHECK constraints in-schema. Each
-- source sets exactly its own link columns and nulls the others; the CARD
-- branch keeps the installment invariants and the IMPORTED branch requires the
-- dedup/provenance columns. Existing MANUAL/RECURRING/CARD rows satisfy the new
-- constraint (import columns default NULL), so the swap is backward-compatible.
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_source_link_chk";
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_source_link_chk" CHECK (
  (source = 'MANUAL'    AND "recurringBillId" IS NULL AND "periodKey" IS NULL
                        AND "creditCardId" IS NULL AND "cardPurchaseId" IS NULL AND "invoiceCycle" IS NULL
                        AND "installmentSeq" IS NULL AND "installmentTotal" IS NULL
                        AND "dedupHash" IS NULL AND "importRunId" IS NULL)
  OR (source = 'RECURRING' AND "recurringBillId" IS NOT NULL AND "periodKey" IS NOT NULL
                        AND "creditCardId" IS NULL AND "cardPurchaseId" IS NULL AND "invoiceCycle" IS NULL
                        AND "installmentSeq" IS NULL AND "installmentTotal" IS NULL
                        AND "dedupHash" IS NULL AND "importRunId" IS NULL)
  OR (source = 'CARD'   AND "recurringBillId" IS NULL AND "periodKey" IS NULL
                        AND "creditCardId" IS NOT NULL AND "cardPurchaseId" IS NOT NULL AND "invoiceCycle" IS NOT NULL
                        AND "installmentSeq" IS NOT NULL AND "installmentTotal" IS NOT NULL
                        AND "installmentSeq" >= 1 AND "installmentTotal" >= 1
                        AND "installmentSeq" <= "installmentTotal"
                        AND "dedupHash" IS NULL AND "importRunId" IS NULL)
  OR (source = 'IMPORTED' AND "recurringBillId" IS NULL AND "periodKey" IS NULL
                        AND "creditCardId" IS NULL AND "cardPurchaseId" IS NULL AND "invoiceCycle" IS NULL
                        AND "installmentSeq" IS NULL AND "installmentTotal" IS NULL
                        AND "dedupHash" IS NOT NULL AND "importRunId" IS NOT NULL)
);

-- DB-level R6 duplicate guarantee: at most one IMPORTED row per (user, dedup
-- key). Partial index — manual addition, Prisma cannot express the WHERE.
-- Scoped to IMPORTED so manual/recurring/card rows (dedupHash NULL) never
-- participate. `createMany({ skipDuplicates: true })` emits ON CONFLICT DO
-- NOTHING, so an overlapping import skips rather than fails.
CREATE UNIQUE INDEX "transactions_user_dedup_uq" ON "transactions" ("userId", "dedupHash") WHERE source = 'IMPORTED';
