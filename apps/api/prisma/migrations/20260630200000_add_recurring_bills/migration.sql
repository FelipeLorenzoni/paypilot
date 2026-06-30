-- AlterEnum
ALTER TYPE "TransactionSource" ADD VALUE 'RECURRING';

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "periodKey" CHAR(7),
ADD COLUMN     "recurringBillId" UUID;

-- CreateTable
CREATE TABLE "recurring_bills" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "dayOfMonth" SMALLINT NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "categoryLabel" VARCHAR(100),
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "recurring_bills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_bills_userId_idx" ON "recurring_bills"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_recurringBillId_periodKey_key" ON "transactions"("recurringBillId", "periodKey");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurringBillId_fkey" FOREIGN KEY ("recurringBillId") REFERENCES "recurring_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_bills" ADD CONSTRAINT "recurring_bills_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Valid recurring-link states (financial-rules R13, manual addition — Prisma
-- cannot model CHECK constraints in-schema). A RECURRING row MUST carry both
-- recurringBillId and periodKey; any non-RECURRING row (e.g. MANUAL) MUST have
-- both NULL. This complements the composite unique index that enforces R3
-- idempotency (at most one generated row per bill/period).
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_link_chk" CHECK (
    (source = 'RECURRING' AND "recurringBillId" IS NOT NULL AND "periodKey" IS NOT NULL)
    OR (source <> 'RECURRING' AND "recurringBillId" IS NULL AND "periodKey" IS NULL)
);
