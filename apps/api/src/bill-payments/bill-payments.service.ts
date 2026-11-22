import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { BillPaymentView, SetBillPaymentRequest } from "@paypilot/shared";
import { CLOCK, type Clock } from "../common/clock";
import { toDateString } from "../common/ledger-money-date";
import { BillPaymentsRepository } from "./bill-payments.repository";

/**
 * Product-level paid state (requirements 2, 3). Mark records a payment dated
 * today (UTC calendar date of the injected clock) or an earlier date the user
 * chose — never a future one; unmark removes it. Both are idempotent and
 * never look at the item's due date. Date rules run before the target is
 * resolved, so a bad date never reveals whether a target exists.
 */
@Injectable()
export class BillPaymentsService {
  constructor(
    private readonly repo: BillPaymentsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async setPayment(
    userId: string,
    input: SetBillPaymentRequest,
  ): Promise<BillPaymentView> {
    const now = this.clock.now();
    const today = toDateString(now);

    if (!input.paid && input.paidOn !== undefined) {
      throw new BadRequestException("paidOn is only allowed when paid is true");
    }
    const paidOn = input.paidOn ?? today;
    if (input.paid && paidOn > today) {
      throw new BadRequestException("paidOn must not be in the future");
    }

    const target = await this.repo.resolveOwnedTarget(userId, input);
    if (!target) {
      throw new NotFoundException();
    }

    if (!input.paid) {
      await this.repo.unmark(userId, target);
      return {
        targetType: target.targetType,
        targetKey: target.targetKey,
        paid: false,
        paidOn: null,
        recordedAt: null,
      };
    }

    const record = await this.repo.markPaid(userId, target, paidOn, now);
    return {
      targetType: record.targetType,
      targetKey: record.targetKey,
      paid: true,
      paidOn: record.paidOn,
      recordedAt: record.recordedAt,
    };
  }
}
