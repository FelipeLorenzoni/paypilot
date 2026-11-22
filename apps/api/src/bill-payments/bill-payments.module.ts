import { Module } from "@nestjs/common";
import { BillPaymentsController } from "./bill-payments.controller";
import { BillPaymentsRepository } from "./bill-payments.repository";
import { BillPaymentsService } from "./bill-payments.service";

/**
 * Bill payments: the product-level paid state of recurring occurrences and
 * card invoices, stored in `payment_markers`. The only writer of that table;
 * reminders delegate their paid endpoint here and cards read invoice payments.
 * Never mutates ledger rows. Routes protected by the global JwtAuthGuard.
 */
@Module({
  controllers: [BillPaymentsController],
  providers: [BillPaymentsRepository, BillPaymentsService],
  exports: [BillPaymentsRepository, BillPaymentsService],
})
export class BillPaymentsModule {}
