import { Injectable } from "@nestjs/common";
import {
  toAmountNumber,
  toDateOnly,
  toDateString,
} from "../common/ledger-money-date";
import { PrismaService } from "../prisma/prisma.service";
import {
  cardInvoiceTarget,
  type DueItem,
  recurringTarget,
  type ReminderTarget,
} from "./domain/reminder-target";

/**
 * Reads for the reminder flow. Cross-feature but strictly READ-ONLY over the
 * ledger: reminders never mutate `transactions`. Relies on the documented
 * cross-feature invariant that a RECURRING row's `transactionDate` is the
 * occurrence due date and a CARD row's `transactionDate` is its invoice
 * cycle's due date (see design.md / tasks.md).
 */
@Injectable()
export class RemindersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * All users' reminder-eligible unpaid due items for the given due dates,
   * already filtered to users with reminders enabled + a destination (6.3:
   * opted-out users produce no work and no rows). RECURRING paid filtering
   * rides on the marker relation; card invoices are grouped per (card, cycle)
   * and excluded via their invoice-level markers. Selection-level R1 only —
   * the send path re-checks paid status (3.2).
   */
  async findDueItems(dueDates: readonly string[]): Promise<DueItem[]> {
    if (dueDates.length === 0) {
      return [];
    }
    const dates = dueDates.map(toDateOnly);
    const optedIn = {
      reminderSettings: {
        is: { enabled: true, phoneE164: { not: null } },
      },
    };
    const destinationSelect = {
      select: { reminderSettings: { select: { phoneE164: true } } },
    };

    const recurringRows = await this.prisma.transaction.findMany({
      where: {
        source: "RECURRING",
        transactionDate: { in: dates },
        paymentMarkers: { none: {} },
        user: optedIn,
      },
      select: {
        id: true,
        userId: true,
        amountMinor: true,
        currency: true,
        transactionDate: true,
        description: true,
        user: destinationSelect,
      },
    });

    const cardRows = await this.prisma.transaction.findMany({
      where: {
        source: "CARD",
        transactionDate: { in: dates },
        user: optedIn,
      },
      select: {
        userId: true,
        creditCardId: true,
        invoiceCycle: true,
        amountMinor: true,
        transactionDate: true,
        creditCard: { select: { label: true } },
        user: destinationSelect,
      },
    });

    const items: DueItem[] = recurringRows.map((row) => ({
      target: recurringTarget(row.id),
      userId: row.userId,
      destination: row.user.reminderSettings?.phoneE164 as string,
      dueDate: toDateString(row.transactionDate),
      description: row.description,
      amountMinor: toAmountNumber(row.amountMinor),
      currency: row.currency,
    }));

    // Group CARD rows into invoices: one item per (user, card, cycle); the
    // invoice amount is the SUM of its rows and every row of a cycle shares
    // the same due date (cross-feature invariant).
    const groups = new Map<string, DueItem>();
    for (const row of cardRows) {
      const target = cardInvoiceTarget(
        row.creditCardId as string,
        (row.invoiceCycle as string).trim(),
      );
      const key = `${row.userId}|${target.targetKey}`;
      const existing = groups.get(key);
      if (existing) {
        existing.amountMinor += toAmountNumber(row.amountMinor);
      } else {
        groups.set(key, {
          target,
          userId: row.userId,
          destination: row.user.reminderSettings?.phoneE164 as string,
          dueDate: toDateString(row.transactionDate),
          description: row.creditCard?.label ?? "Cartão de crédito",
          amountMinor: toAmountNumber(row.amountMinor),
          currency: "BRL",
        });
      }
    }

    if (groups.size > 0) {
      const invoices = [...groups.values()];
      const paid = await this.prisma.paymentMarker.findMany({
        where: {
          targetType: "CARD_INVOICE",
          targetKey: { in: invoices.map((i) => i.target.targetKey) },
        },
        select: { userId: true, targetKey: true },
      });
      const paidKeys = new Set(paid.map((m) => `${m.userId}|${m.targetKey}`));
      for (const invoice of invoices) {
        if (!paidKeys.has(`${invoice.userId}|${invoice.target.targetKey}`)) {
          items.push(invoice);
        }
      }
    }

    return items;
  }

  /** Send-time R1 re-check: paid = marker row present for the identity. */
  async isPaid(userId: string, target: ReminderTarget): Promise<boolean> {
    const marker = await this.prisma.paymentMarker.findUnique({
      where: {
        userId_targetType_targetKey: {
          userId,
          targetType: target.targetType,
          targetKey: target.targetKey,
        },
      },
    });
    return marker !== null;
  }
}
