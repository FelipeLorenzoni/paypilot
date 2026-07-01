import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import type { SafeUser } from "../auth/safe-user";
import { ParseInvoiceCyclePipe } from "../common/parse-invoice-cycle.pipe";
import { type InvoiceView, InvoicesService } from "./invoices.service";

@Controller("credit-cards/:cardId/invoices")
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get(":cycle")
  getInvoice(
    @CurrentUser() user: SafeUser,
    @Param("cardId", ParseUUIDPipe) cardId: string,
    @Param("cycle", ParseInvoiceCyclePipe) cycle: string,
  ): Promise<InvoiceView> {
    return this.invoices.getInvoice(user.id, cardId, cycle);
  }
}
