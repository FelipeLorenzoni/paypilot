import { Module } from "@nestjs/common";
import { CardLedgerWriter } from "./card-ledger-writer";
import { CreditCardsController } from "./credit-cards.controller";
import { CreditCardsRepository } from "./credit-cards.repository";
import { CreditCardsService } from "./credit-cards.service";
import { InvoicesController } from "./invoices.controller";
import { InvoicesService } from "./invoices.service";
import { PurchasesController } from "./purchases.controller";
import { PurchasesService } from "./purchases.service";

/**
 * Credit cards, card purchases (idempotent + atomic installments), and derived
 * invoice views over the shared Transaction ledger (source = CARD). PrismaService
 * is global; routes are protected by the global JwtAuthGuard. No card-transaction
 * edit/delete endpoints (out of scope for this spec).
 */
@Module({
  controllers: [CreditCardsController, PurchasesController, InvoicesController],
  providers: [
    CreditCardsService,
    CreditCardsRepository,
    PurchasesService,
    CardLedgerWriter,
    InvoicesService,
  ],
})
export class CardsModule {}
