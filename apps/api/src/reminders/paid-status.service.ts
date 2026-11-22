import { Injectable } from "@nestjs/common";
import type { PaidTargetInput } from "../bill-payments/bill-payments.repository";
import { BillPaymentsService } from "../bill-payments/bill-payments.service";
import type { ReminderTargetType } from "./domain/reminder-target";

export interface PaidStatusView {
  targetType: ReminderTargetType;
  targetKey: string;
  paid: boolean;
  paidAt: string | null; // ISO instant
}

/**
 * `PUT /reminders/paid`, kept for compatibility (bill-payments requirement
 * 7.3). A thin adapter over the product-level BillPaymentsService: same
 * ownership rules and idempotency, payment date always today, and the
 * original reminders response shape (`paidAt` = when the payment was
 * recorded; a re-mark keeps the original one).
 */
@Injectable()
export class PaidStatusService {
  constructor(private readonly payments: BillPaymentsService) {}

  async setPaid(
    userId: string,
    input: PaidTargetInput,
    paid: boolean,
  ): Promise<PaidStatusView> {
    const view = await this.payments.setPayment(userId, { ...input, paid });
    return {
      targetType: view.targetType,
      targetKey: view.targetKey,
      paid: view.paid,
      paidAt: view.recordedAt,
    };
  }
}
