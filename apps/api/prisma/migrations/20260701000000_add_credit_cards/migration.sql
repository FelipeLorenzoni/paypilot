-- AlterEnum
ALTER TYPE "TransactionSource" ADD VALUE 'CARD';

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "cardPurchaseId" UUID,
ADD COLUMN     "creditCardId" UUID,
ADD COLUMN     "installmentSeq" SMALLINT,
ADD COLUMN     "installmentTotal" SMALLINT,
ADD COLUMN     "invoiceCycle" CHAR(7);

-- CreateTable
CREATE TABLE "credit_cards" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "closingDay" SMALLINT NOT NULL,
    "dueDay" SMALLINT NOT NULL,
    "creditLimitMinor" BIGINT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "credit_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_purchases" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "creditCardId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "purchaseDate" DATE NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "categoryLabel" VARCHAR(100),
    "installments" SMALLINT NOT NULL,
    "startCycle" CHAR(7) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "card_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_cards_userId_idx" ON "credit_cards"("userId");

-- CreateIndex
CREATE INDEX "card_purchases_creditCardId_idx" ON "card_purchases"("creditCardId");

-- CreateIndex
CREATE UNIQUE INDEX "card_purchases_userId_idempotencyKey_key" ON "card_purchases"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "transactions_creditCardId_invoiceCycle_idx" ON "transactions"("creditCardId", "invoiceCycle");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_creditCardId_fkey" FOREIGN KEY ("creditCardId") REFERENCES "credit_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_cardPurchaseId_fkey" FOREIGN KEY ("cardPurchaseId") REFERENCES "card_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_purchases" ADD CONSTRAINT "card_purchases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_purchases" ADD CONSTRAINT "card_purchases_creditCardId_fkey" FOREIGN KEY ("creditCardId") REFERENCES "credit_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rewrite the source-aware link CHECK to cover a third source (CARD). Manual
-- addition — Prisma cannot model CHECK constraints in-schema. Drop the
-- recurring-only constraint and add one that validates the valid link state for
-- each of MANUAL / RECURRING / CARD; the CARD branch also enforces the
-- installment invariants (1 <= seq <= total). Existing MANUAL/RECURRING rows
-- satisfy the new constraint (card columns default NULL), so the swap is
-- backward-compatible.
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_recurring_link_chk";
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_source_link_chk" CHECK (
  (source = 'MANUAL' AND "recurringBillId" IS NULL AND "periodKey" IS NULL
                     AND "creditCardId" IS NULL AND "cardPurchaseId" IS NULL AND "invoiceCycle" IS NULL
                     AND "installmentSeq" IS NULL AND "installmentTotal" IS NULL)
  OR (source = 'RECURRING' AND "recurringBillId" IS NOT NULL AND "periodKey" IS NOT NULL
                     AND "creditCardId" IS NULL AND "cardPurchaseId" IS NULL AND "invoiceCycle" IS NULL
                     AND "installmentSeq" IS NULL AND "installmentTotal" IS NULL)
  OR (source = 'CARD' AND "recurringBillId" IS NULL AND "periodKey" IS NULL
                     AND "creditCardId" IS NOT NULL AND "cardPurchaseId" IS NOT NULL AND "invoiceCycle" IS NOT NULL
                     AND "installmentSeq" IS NOT NULL AND "installmentTotal" IS NOT NULL
                     AND "installmentSeq" >= 1 AND "installmentTotal" >= 1
                     AND "installmentSeq" <= "installmentTotal")
);
