import { Inject, Injectable } from "@nestjs/common";
import { CLOCK, type Clock } from "../common/clock";
import { toDateOnly } from "../common/ledger-money-date";
import { PrismaService } from "../prisma/prisma.service";
import type { NotificationChannel } from "../integrations/notifications/notification-provider";
import type { ReminderTarget } from "./domain/reminder-target";
import { STALE_CLAIM_HOURS } from "./reminder.constants";

/** The full R2 identity of one logical reminder delivery. */
export interface DeliveryIdentity {
  userId: string;
  target: ReminderTarget;
  dueDate: string; // YYYY-MM-DD
  windowDaysBefore: number;
  channel: NotificationChannel;
}

export type ClaimResult = "claimed" | "already-owned";
export type FinalStatus = "SENT" | "FAILED" | "SKIPPED";

const PRISMA_UNIQUE_VIOLATION = "P2002";

/**
 * The R2 claim state machine (design.md). The composite unique index on
 * `reminder_deliveries` is the source of truth: `claim` INSERTs the PENDING
 * row (a unique conflict means another claimer owns the identity) and, on
 * conflict, atomically re-claims only FAILED or stale-PENDING rows via a
 * conditional `updateMany` — `count 1` wins, `count 0` loses. SENT and SKIPPED
 * are terminal forever (a paid→unpaid flip never re-opens a consumed
 * identity). This guarantees at most one successful RECORDED delivery per
 * identity; true exactly-once EXTERNAL delivery is explicitly out of scope in
 * the MVP (stub/log providers only — see design.md).
 */
@Injectable()
export class ReminderDeliveryStore {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async claim(identity: DeliveryIdentity): Promise<ClaimResult> {
    try {
      await this.prisma.reminderDelivery.create({
        data: {
          userId: identity.userId,
          targetType: identity.target.targetType,
          targetKey: identity.target.targetKey,
          transactionId: identity.target.transactionId,
          creditCardId: identity.target.creditCardId,
          invoiceCycle: identity.target.invoiceCycle,
          dueDate: toDateOnly(identity.dueDate),
          windowDaysBefore: identity.windowDaysBefore,
          channel: identity.channel,
          status: "PENDING",
          attempt: 1,
        },
      });
      return "claimed";
    } catch (error) {
      if (!this.isUniqueViolation(error)) {
        throw error;
      }
    }

    const staleBefore = new Date(
      this.clock.now().getTime() - STALE_CLAIM_HOURS * 3_600_000,
    );
    const { count } = await this.prisma.reminderDelivery.updateMany({
      where: {
        ...this.identityWhere(identity),
        OR: [
          { status: "FAILED" },
          { status: "PENDING", updatedAt: { lt: staleBefore } },
        ],
      },
      data: { status: "PENDING", attempt: { increment: 1 }, errorCode: null },
    });
    return count === 1 ? "claimed" : "already-owned";
  }

  /** Guarded on PENDING so a finalize can never clobber a terminal state. */
  async finalize(
    identity: DeliveryIdentity,
    status: FinalStatus,
    errorCode?: string,
  ): Promise<void> {
    await this.prisma.reminderDelivery.updateMany({
      where: { ...this.identityWhere(identity), status: "PENDING" },
      data: {
        status,
        errorCode: errorCode ?? null,
        ...(status === "SENT" ? { sentAt: this.clock.now() } : {}),
      },
    });
  }

  private identityWhere(identity: DeliveryIdentity) {
    return {
      userId: identity.userId,
      targetType: identity.target.targetType,
      targetKey: identity.target.targetKey,
      dueDate: toDateOnly(identity.dueDate),
      windowDaysBefore: identity.windowDaysBefore,
      channel: identity.channel,
    };
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
