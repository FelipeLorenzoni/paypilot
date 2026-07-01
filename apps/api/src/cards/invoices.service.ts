import { Injectable, NotFoundException } from "@nestjs/common";
import { toAmountNumber } from "../common/ledger-money-date";
import { PrismaService } from "../prisma/prisma.service";
import {
  type CardTransactionResponse,
  toCardTransactionResponse,
} from "./card.mapper";
import { CreditCardsRepository } from "./credit-cards.repository";
import { dueDate } from "./domain/invoice-assignment";

export interface InvoiceView {
  cardId: string;
  cycle: string; // YYYY-MM (closing month)
  dueDate: string; // YYYY-MM-DD
  totalMinor: number;
  transactions: CardTransactionResponse[];
}

/**
 * Derived invoice view — no stored Invoice entity. Sums the CARD ledger rows
 * assigned to a (card, cycle) and computes the due date from the card. Works
 * for inactive cards too (history is preserved after deactivation).
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly cards: CreditCardsRepository,
    private readonly prisma: PrismaService,
  ) {}

  async getInvoice(
    userId: string,
    cardId: string,
    cycle: string,
  ): Promise<InvoiceView> {
    const card = await this.cards.findOwned(userId, cardId);
    if (!card) {
      throw new NotFoundException();
    }

    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        source: "CARD",
        creditCardId: cardId,
        invoiceCycle: cycle,
      },
      orderBy: [{ installmentSeq: "asc" }, { id: "asc" }],
    });

    const totalMinor = rows.reduce((sum, row) => sum + row.amountMinor, 0n);

    return {
      cardId,
      cycle,
      dueDate: dueDate(cycle, card.closingDay, card.dueDay),
      totalMinor: toAmountNumber(totalMinor),
      transactions: rows.map(toCardTransactionResponse),
    };
  }
}
