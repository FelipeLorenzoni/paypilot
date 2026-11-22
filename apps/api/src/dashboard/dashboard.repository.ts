import { Injectable } from "@nestjs/common";
import { toDateOnly, toDateString } from "../common/ledger-money-date";
import { PrismaService } from "../prisma/prisma.service";
import type { LedgerRow, PaidMarker } from "./domain/summarize-month";

const LEDGER_ROW_SELECT = {
  id: true,
  source: true,
  amountMinor: true,
  currency: true,
  transactionDate: true,
  description: true,
  categoryLabel: true,
  creditCardId: true,
  invoiceCycle: true,
  creditCard: { select: { label: true } },
} as const;

/**
 * Owner-scoped, READ-ONLY reads for the monthly summary (requirements 8.5,
 * 8.6, 9.2). `userId` is in every `where`, and the class defines no write
 * method at all: the dashboard owns no table and never mutates the ledger or
 * the paid markers. Ranges are inclusive date-only `YYYY-MM-DD` values served
 * by the existing `@@index([userId, transactionDate, id])`.
 */
@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Every ledger row of one user inside `[start, end]`, any source. */
  async findMonthRows(
    userId: string,
    start: string,
    end: string,
  ): Promise<LedgerRow[]> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        transactionDate: { gte: toDateOnly(start), lte: toDateOnly(end) },
      },
      select: LEDGER_ROW_SELECT,
    });
    return rows.map(toLedgerRow);
  }

  /** The look-back window's payable (RECURRING/CARD) rows of one user. */
  async findPayableRows(
    userId: string,
    start: string,
    end: string,
  ): Promise<LedgerRow[]> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        source: { in: ["RECURRING", "CARD"] },
        transactionDate: { gte: toDateOnly(start), lte: toDateOnly(end) },
      },
      select: LEDGER_ROW_SELECT,
    });
    return rows.map(toLedgerRow);
  }

  /** The user's paid markers for the given canonical target keys. */
  async findPaidKeys(
    userId: string,
    targetKeys: readonly string[],
  ): Promise<PaidMarker[]> {
    if (targetKeys.length === 0) {
      return [];
    }
    const markers = await this.prisma.paymentMarker.findMany({
      where: { userId, targetKey: { in: [...targetKeys] } },
      select: { targetKey: true, paidAt: true, paidOn: true },
    });
    return markers.map((m) => ({
      targetKey: m.targetKey,
      paidAt: m.paidAt.toISOString(),
      paidOn: toDateString(m.paidOn),
    }));
  }
}

function toLedgerRow(row: {
  id: string;
  source: LedgerRow["source"];
  amountMinor: bigint;
  currency: string;
  transactionDate: Date;
  description: string;
  categoryLabel: string | null;
  creditCardId: string | null;
  invoiceCycle: string | null;
  creditCard: { label: string } | null;
}): LedgerRow {
  return {
    id: row.id,
    source: row.source,
    amountMinor: row.amountMinor,
    currency: row.currency,
    transactionDate: toDateString(row.transactionDate),
    description: row.description,
    categoryLabel: row.categoryLabel,
    creditCardId: row.creditCardId,
    creditCardLabel: row.creditCard?.label ?? null,
    // CHAR(7) column: trim defensively, as the reminders repository does.
    invoiceCycle: row.invoiceCycle?.trim() ?? null,
  };
}
