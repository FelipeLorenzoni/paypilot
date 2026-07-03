-- due-date-reminders: three side tables (settings, paid markers, deliveries).
-- The ledger tables are UNTOUCHED — no ALTER on "transactions"/"users"/
-- "credit_cards" (the Prisma inverse relations are schema-file-only). The
-- composite unique index on reminder_deliveries is the DB-level R2 guarantee.

-- CreateEnum
CREATE TYPE "ReminderTargetType" AS ENUM ('RECURRING_TRANSACTION', 'CARD_INVOICE');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WHATSAPP');

-- CreateEnum
CREATE TYPE "ReminderDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "reminder_settings" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "phoneE164" VARCHAR(16),
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reminder_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_markers" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "targetType" "ReminderTargetType" NOT NULL,
    "targetKey" VARCHAR(90) NOT NULL,
    "transactionId" UUID,
    "creditCardId" UUID,
    "invoiceCycle" CHAR(7),
    "paidAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_markers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_deliveries" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "targetType" "ReminderTargetType" NOT NULL,
    "targetKey" VARCHAR(90) NOT NULL,
    "transactionId" UUID,
    "creditCardId" UUID,
    "invoiceCycle" CHAR(7),
    "dueDate" DATE NOT NULL,
    "windowDaysBefore" SMALLINT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "ReminderDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "errorCode" VARCHAR(64),
    "sentAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reminder_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reminder_settings_userId_key" ON "reminder_settings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_markers_userId_targetType_targetKey_key" ON "payment_markers"("userId", "targetType", "targetKey");

-- CreateIndex
CREATE INDEX "payment_markers_userId_idx" ON "payment_markers"("userId");

-- CreateIndex (R2 source of truth: at most one recorded delivery per identity)
CREATE UNIQUE INDEX "reminder_deliveries_identity_uq" ON "reminder_deliveries"("userId", "targetType", "targetKey", "dueDate", "windowDaysBefore", "channel");

-- CreateIndex
CREATE INDEX "reminder_deliveries_userId_idx" ON "reminder_deliveries"("userId");

-- AddForeignKey
ALTER TABLE "reminder_settings" ADD CONSTRAINT "reminder_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_markers" ADD CONSTRAINT "payment_markers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_markers" ADD CONSTRAINT "payment_markers_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_markers" ADD CONSTRAINT "payment_markers_creditCardId_fkey" FOREIGN KEY ("creditCardId") REFERENCES "credit_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_creditCardId_fkey" FOREIGN KEY ("creditCardId") REFERENCES "credit_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Manual addition — Prisma cannot model CHECK constraints in-schema. Each
-- targetType sets exactly its own typed columns (targetKey consistency is
-- application-derived; the typed columns + FKs carry referential integrity).
ALTER TABLE "payment_markers" ADD CONSTRAINT "payment_markers_target_chk" CHECK (
  ("targetType" = 'RECURRING_TRANSACTION' AND "transactionId" IS NOT NULL
                                          AND "creditCardId" IS NULL AND "invoiceCycle" IS NULL)
  OR ("targetType" = 'CARD_INVOICE' AND "transactionId" IS NULL
                                    AND "creditCardId" IS NOT NULL AND "invoiceCycle" IS NOT NULL)
);

ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_target_chk" CHECK (
  ("targetType" = 'RECURRING_TRANSACTION' AND "transactionId" IS NOT NULL
                                          AND "creditCardId" IS NULL AND "invoiceCycle" IS NULL)
  OR ("targetType" = 'CARD_INVOICE' AND "transactionId" IS NULL
                                    AND "creditCardId" IS NOT NULL AND "invoiceCycle" IS NOT NULL)
);
