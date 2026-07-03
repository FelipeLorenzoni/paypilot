import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { CLOCK, type Clock } from "../common/clock";
import { PrismaService } from "../prisma/prisma.service";
import type { ReminderTargetType } from "./domain/reminder-target";
import {
  type PaidTargetInput,
  RemindersRepository,
} from "./reminders.repository";

export interface PaidStatusView {
  targetType: ReminderTargetType;
  targetKey: string;
  paid: boolean;
  paidAt: string | null; // ISO instant
}

/**
 * Mark/unmark reminder-eligible items as paid (requirement 2). Paid = marker
 * row presence: mark is an idempotent upsert (`update: {}` — re-marking has no
 * side effects, the original `paidAt` stands), unmark an idempotent delete.
 * Never touches ledger rows; card markers are invoice-level (one per
 * (card, cycle)). Unknown/unowned targets — including MANUAL/IMPORTED ids —
 * are a 404 without disclosure.
 */
@Injectable()
export class PaidStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: RemindersRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async setPaid(
    userId: string,
    input: PaidTargetInput,
    paid: boolean,
  ): Promise<PaidStatusView> {
    const target = await this.repo.resolveOwnedTarget(userId, input);
    if (!target) {
      throw new NotFoundException();
    }

    if (paid) {
      const marker = await this.prisma.paymentMarker.upsert({
        where: {
          userId_targetType_targetKey: {
            userId,
            targetType: target.targetType,
            targetKey: target.targetKey,
          },
        },
        create: {
          userId,
          targetType: target.targetType,
          targetKey: target.targetKey,
          transactionId: target.transactionId,
          creditCardId: target.creditCardId,
          invoiceCycle: target.invoiceCycle,
          paidAt: this.clock.now(),
        },
        update: {},
      });
      return {
        targetType: target.targetType,
        targetKey: target.targetKey,
        paid: true,
        paidAt: marker.paidAt.toISOString(),
      };
    }

    await this.prisma.paymentMarker.deleteMany({
      where: {
        userId,
        targetType: target.targetType,
        targetKey: target.targetKey,
      },
    });
    return {
      targetType: target.targetType,
      targetKey: target.targetKey,
      paid: false,
      paidAt: null,
    };
  }
}
