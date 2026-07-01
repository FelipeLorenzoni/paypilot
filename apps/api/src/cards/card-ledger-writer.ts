import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** One generated installment row (already computed by the service). */
export interface InstallmentRow {
  invoiceCycle: string; // YYYY-MM
  installmentSeq: number;
  installmentTotal: number;
  amountMinor: bigint;
  transactionDate: Date; // cycle due date (date-only)
}

/** A fully-computed purchase plan ready to persist atomically. */
export interface CardPurchasePlan {
  userId: string;
  creditCardId: string;
  idempotencyKey: string;
  requestHash: string;
  purchaseDate: Date;
  amountMinor: bigint;
  currency: string;
  description: string;
  categoryLabel: string | null;
  installments: number;
  startCycle: string;
  rows: InstallmentRow[];
}

/**
 * Owns the atomic write of a card purchase: the `CardPurchase` plan plus all N
 * `Transaction` rows in a **single interactive transaction** — all-or-none, so a
 * partial installment schedule is impossible. DB-level idempotency comes from
 * the `@@unique([userId, idempotencyKey])` on the plan (a duplicate insert
 * throws P2002, reconciled by the service).
 */
@Injectable()
export class CardLedgerWriter {
  constructor(private readonly prisma: PrismaService) {}

  async create(plan: CardPurchasePlan) {
    return this.prisma.$transaction(async (tx) => {
      const purchase = await tx.cardPurchase.create({
        data: {
          userId: plan.userId,
          creditCardId: plan.creditCardId,
          idempotencyKey: plan.idempotencyKey,
          requestHash: plan.requestHash,
          purchaseDate: plan.purchaseDate,
          amountMinor: plan.amountMinor,
          currency: plan.currency,
          description: plan.description,
          categoryLabel: plan.categoryLabel,
          installments: plan.installments,
          startCycle: plan.startCycle,
        },
      });
      const transactions = [];
      for (const row of plan.rows) {
        transactions.push(
          await tx.transaction.create({
            data: {
              userId: plan.userId,
              type: "EXPENSE",
              source: "CARD",
              amountMinor: row.amountMinor,
              currency: plan.currency,
              transactionDate: row.transactionDate,
              description: plan.description,
              categoryLabel: plan.categoryLabel,
              creditCardId: plan.creditCardId,
              cardPurchaseId: purchase.id,
              invoiceCycle: row.invoiceCycle,
              installmentSeq: row.installmentSeq,
              installmentTotal: row.installmentTotal,
            },
          }),
        );
      }
      return { purchase, transactions };
    });
  }

  /** Existing purchase + its transactions for idempotent reconciliation. */
  async findByKey(userId: string, idempotencyKey: string) {
    const purchase = await this.prisma.cardPurchase.findFirst({
      where: { userId, idempotencyKey },
    });
    if (!purchase) {
      return null;
    }
    const transactions = await this.prisma.transaction.findMany({
      where: { cardPurchaseId: purchase.id },
      orderBy: [{ installmentSeq: "asc" }, { id: "asc" }],
    });
    return { purchase, transactions };
  }
}
