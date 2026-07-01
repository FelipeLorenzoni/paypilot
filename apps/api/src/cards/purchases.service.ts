import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createMoney } from "@paypilot/shared";
import { toAmountBigInt, toDateOnly } from "../common/ledger-money-date";
import {
  type CardTransactionResponse,
  toCardTransactionResponse,
} from "./card.mapper";
import { CardLedgerWriter, type InstallmentRow } from "./card-ledger-writer";
import { CreditCardsRepository } from "./credit-cards.repository";
import { assignCycle, dueDate } from "./domain/invoice-assignment";
import { installmentCycles, splitInstallments } from "./domain/installments";
import type { CreatePurchaseDto } from "./dto/create-purchase.dto";

const PRISMA_UNIQUE_VIOLATION = "P2002";

export interface PurchaseResult {
  id: string;
  cardId: string;
  installments: number;
  transactions: CardTransactionResponse[];
}

@Injectable()
export class PurchasesService {
  constructor(
    private readonly cards: CreditCardsRepository,
    private readonly writer: CardLedgerWriter,
  ) {}

  async create(
    userId: string,
    cardId: string,
    dto: CreatePurchaseDto,
  ): Promise<PurchaseResult> {
    const card = await this.cards.findOwned(userId, cardId);
    if (!card) {
      throw new NotFoundException();
    }
    if (!card.isActive) {
      throw new BadRequestException("card is inactive");
    }

    // Validate money (safe-integer + ISO-4217) for the total.
    const money = createMoney(dto.amountMinor, dto.currency);
    const category = dto.category ?? null;

    // Assignment (R4) + split (R5) — pure domain, no clock.
    const startCycle = assignCycle(dto.purchaseDate, card.closingDay);
    const amounts = splitInstallments(money.amountMinor, dto.installments);
    const cycles = installmentCycles(startCycle, dto.installments);
    const rows: InstallmentRow[] = amounts.map((amount, i) => {
      const cycle = cycles[i] as string;
      // Re-validate each per-installment amount via the shared money guard.
      createMoney(amount, money.currency);
      return {
        invoiceCycle: cycle,
        installmentSeq: i + 1,
        installmentTotal: dto.installments,
        amountMinor: toAmountBigInt(amount),
        transactionDate: toDateOnly(
          dueDate(cycle, card.closingDay, card.dueDay),
        ),
      };
    });

    const requestHash = this.computeRequestHash({
      creditCardId: cardId,
      purchaseDate: dto.purchaseDate,
      amountMinor: money.amountMinor,
      currency: money.currency,
      description: dto.description,
      category,
      installments: dto.installments,
    });

    try {
      const { purchase, transactions } = await this.writer.create({
        userId,
        creditCardId: cardId,
        idempotencyKey: dto.idempotencyKey,
        requestHash,
        purchaseDate: toDateOnly(dto.purchaseDate),
        amountMinor: toAmountBigInt(money.amountMinor),
        currency: money.currency,
        description: dto.description,
        categoryLabel: category,
        installments: dto.installments,
        startCycle,
        rows,
      });
      return {
        id: purchase.id,
        cardId,
        installments: purchase.installments,
        transactions: transactions.map(toCardTransactionResponse),
      };
    } catch (error) {
      if (!this.isUniqueViolation(error)) {
        throw error;
      }
      // Idempotent reconciliation: the key already exists for this user.
      return this.reconcileExisting(
        userId,
        cardId,
        dto.idempotencyKey,
        requestHash,
      );
    }
  }

  private async reconcileExisting(
    userId: string,
    cardId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<PurchaseResult> {
    const existing = await this.writer.findByKey(userId, idempotencyKey);
    if (
      !existing ||
      existing.purchase.creditCardId !== cardId ||
      existing.purchase.requestHash !== requestHash
    ) {
      // Same key reused with a divergent payload or a different card.
      throw new ConflictException("IDEMPOTENCY_KEY_REUSED");
    }
    return {
      id: existing.purchase.id,
      cardId: existing.purchase.creditCardId,
      installments: existing.purchase.installments,
      transactions: existing.transactions.map(toCardTransactionResponse),
    };
  }

  /** sha-256 of the normalized full payload that affects persisted output. */
  private computeRequestHash(input: {
    creditCardId: string;
    purchaseDate: string;
    amountMinor: number;
    currency: string;
    description: string;
    category: string | null;
    installments: number;
  }): string {
    const canonical = JSON.stringify({
      creditCardId: input.creditCardId,
      purchaseDate: input.purchaseDate,
      amountMinor: input.amountMinor,
      currency: input.currency.toUpperCase(),
      description: input.description.trim(),
      category: input.category === null ? null : input.category.trim(),
      installments: input.installments,
    });
    return createHash("sha256").update(canonical).digest("hex");
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === PRISMA_UNIQUE_VIOLATION
    );
  }
}
