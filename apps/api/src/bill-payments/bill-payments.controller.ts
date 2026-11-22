import { Body, Controller, Put } from "@nestjs/common";
import type { BillPaymentView } from "@paypilot/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import type { SafeUser } from "../auth/safe-user";
import { BillPaymentsService } from "./bill-payments.service";
import { SetBillPaymentDto } from "./dto/set-bill-payment.dto";

/**
 * Product-level mark/unmark endpoint. Protected by the global JwtAuthGuard
 * (401); ownership is verified in the service (404 without disclosure).
 * Idempotent: repeating a request leaves the same state.
 */
@Controller("bill-payments")
export class BillPaymentsController {
  constructor(private readonly payments: BillPaymentsService) {}

  @Put()
  setPayment(
    @CurrentUser() user: SafeUser,
    @Body() dto: SetBillPaymentDto,
  ): Promise<BillPaymentView> {
    return this.payments.setPayment(user.id, dto);
  }
}
