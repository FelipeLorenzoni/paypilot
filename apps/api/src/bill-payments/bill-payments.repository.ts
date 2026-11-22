import { Injectable } from "@nestjs/common";
import { toDateOnly, toDateString } from "../common/ledger-money-date";
import { PrismaService } from "../prisma/prisma.service";
import {
  cardInvoiceTarget,
  recurringTarget,
  type ReminderTarget,
  type ReminderTargetType,
} from "../reminders/domain/reminder-target";

const PRISMA_UNIQUE_VIOLATION = "P2002";

/** Client-shaped identity parts of a payable item (validated by DTOs). */
export interface PaidTargetInput {
  targetType: ReminderTargetType;
  transactionId?: string;
  creditCardId?: string;
  invoiceCycle?: string;
}

/** A stored payment, reduced to what callers need. */
export interface PaymentRecord {
  targetType: ReminderTargetType;
  targetKey: string;
  paidOn: string; // YYYY-MM-DD
  recordedAt: string; // ISO UTC (the `paidAt` column)
}

const RECORD_SELECT = {
  targetType: true,
  targetKey: true,
  paidOn: true,
  paidAt: true,
} as const;

/**
 * The only writer of `payment_markers` (requirements 1.x, 4.x). Every query is
 * scoped to the user; ledger rows are only ever read, for ownership checks.
 * Identity keys are derived here from validated parts via the canonical
 * reminder-target helpers, so reminders and the dashboard read the same rows.
 */
@Injectable()
export class BillPaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve client-supplied parts to the canonical identity iff the item
   * exists and belongs to the user: an owned `source = RECURRING` row, or an
   * owned card with at least one CARD row in the cycle. Anything else —
   * including MANUAL/IMPORTED transaction ids — resolves to null (→ 404).
   */
  async resolveOwnedTarget(
    userId: string,
    input: PaidTargetInput,
  ): Promise<ReminderTarget | null> {
    if (input.targetType === "RECURRING_TRANSACTION") {
      if (!input.transactionId) {
        return null;
      }
      const row = await this.prisma.transaction.findFirst({
        where: { id: input.transactionId, userId, source: "RECURRING" },
        select: { id: true },
      });
      return row ? recurringTarget(row.id) : null;
    }

    if (!input.creditCardId || !input.invoiceCycle) {
      return null;
    }
    const card = await this.prisma.creditCard.findFirst({
      where: { id: input.creditCardId, userId },
      select: { id: true },
    });
    if (!card) {
      return null;
    }
    const anyRow = await this.prisma.transaction.findFirst({
      where: {
        userId,
        source: "CARD",
        creditCardId: input.creditCardId,
        invoiceCycle: input.invoiceCycle,
      },
      select: { id: true },
    });
    return anyRow ? cardInvoiceTarget(card.id, input.invoiceCycle) : null;
  }

  /**
   * Record a payment. An existing record is returned unchanged (idempotent
   * re-mark keeps the original date); a concurrent winner detected through
   * the unique index is re-read and returned, so exactly one record exists.
   */
  async markPaid(
    userId: string,
    target: ReminderTarget,
    paidOn: string,
    recordedAt: Date,
  ): Promise<PaymentRecord> {
    const existing = await this.findPayment(userId, target);
    if (existing) {
      return existing;
    }
    try {
      const created = await this.prisma.paymentMarker.create({
        data: {
          userId,
          targetType: target.targetType,
          targetKey: target.targetKey,
          transactionId: target.transactionId,
          creditCardId: target.creditCardId,
          invoiceCycle: target.invoiceCycle,
          paidOn: toDateOnly(paidOn),
          paidAt: recordedAt,
        },
        select: RECORD_SELECT,
      });
      return toRecord(created);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const winner = await this.findPayment(userId, target);
      if (!winner) {
        throw error;
      }
      return winner;
    }
  }

  /** Remove the user's payment for the item; a no-op when there is none. */
  async unmark(userId: string, target: ReminderTarget): Promise<void> {
    await this.prisma.paymentMarker.deleteMany({
      where: {
        userId,
        targetType: target.targetType,
        targetKey: target.targetKey,
      },
    });
  }

  /** The user's payment for one item, or null. */
  async findPayment(
    userId: string,
    target: ReminderTarget,
  ): Promise<PaymentRecord | null> {
    const marker = await this.prisma.paymentMarker.findUnique({
      where: {
        userId_targetType_targetKey: {
          userId,
          targetType: target.targetType,
          targetKey: target.targetKey,
        },
      },
      select: RECORD_SELECT,
    });
    return marker ? toRecord(marker) : null;
  }
}

function toRecord(marker: {
  targetType: ReminderTargetType;
  targetKey: string;
  paidOn: Date;
  paidAt: Date;
}): PaymentRecord {
  return {
    targetType: marker.targetType,
    targetKey: marker.targetKey,
    paidOn: toDateString(marker.paidOn),
    recordedAt: marker.paidAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === PRISMA_UNIQUE_VIOLATION
  );
}
