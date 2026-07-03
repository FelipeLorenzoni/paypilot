import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  NOTIFICATION_PROVIDER,
  type NotificationProvider,
} from "../integrations/notifications/notification-provider";
import { formatReminderMessage } from "./domain/reminder-message";
import type { DueItem } from "./domain/reminder-target";
import { addDays, windowsFor } from "./domain/reminder-windows";
import {
  type DeliveryIdentity,
  ReminderDeliveryStore,
} from "./reminder-delivery.store";
import { REMINDER_WINDOWS_DAYS_BEFORE } from "./reminder.constants";
import { RemindersRepository } from "./reminders.repository";

/** Per-run outcome. Counts only — never exposes per-user data. */
export interface EvaluationSummary {
  evaluated: number;
  sent: number;
  skippedClaimed: number;
  skippedPaid: number;
  failed: number;
}

/**
 * One evaluation run (design.md System Flow): select due unpaid items for the
 * matching windows → claim the delivery identity (R2: no send ever happens
 * without a successful claim) → re-check paid at send time (R1) → send via the
 * provider port → finalize SENT/FAILED/SKIPPED. Items are processed
 * independently: one failure is logged (codes only — never message bodies or
 * unmasked phones) and the run continues (1.6).
 */
@Injectable()
export class ReminderEvaluationService {
  private readonly logger = new Logger(ReminderEvaluationService.name);

  constructor(
    private readonly repo: RemindersRepository,
    private readonly store: ReminderDeliveryStore,
    @Inject(NOTIFICATION_PROVIDER)
    private readonly provider: NotificationProvider,
  ) {}

  async evaluate(todayUtc: string): Promise<EvaluationSummary> {
    const summary: EvaluationSummary = {
      evaluated: 0,
      sent: 0,
      skippedClaimed: 0,
      skippedPaid: 0,
      failed: 0,
    };

    const dueDates = [
      ...new Set(REMINDER_WINDOWS_DAYS_BEFORE.map((w) => addDays(todayUtc, w))),
    ];
    const items = await this.repo.findDueItems(dueDates);

    for (const item of items) {
      for (const windowDays of windowsFor(item.dueDate, todayUtc)) {
        summary.evaluated += 1;
        try {
          await this.processOne(item, windowDays, summary);
        } catch (error) {
          summary.failed += 1;
          this.logger.error(
            `reminder failed userId=${item.userId} target=${item.target.targetKey} window=${windowDays}`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    }

    this.logger.log(
      `reminders today=${todayUtc} evaluated=${summary.evaluated} sent=${summary.sent} ` +
        `skippedClaimed=${summary.skippedClaimed} skippedPaid=${summary.skippedPaid} failed=${summary.failed}`,
    );
    return summary;
  }

  private async processOne(
    item: DueItem,
    windowDays: number,
    summary: EvaluationSummary,
  ): Promise<void> {
    const identity: DeliveryIdentity = {
      userId: item.userId,
      target: item.target,
      dueDate: item.dueDate,
      windowDaysBefore: windowDays,
      channel: "WHATSAPP",
    };

    if ((await this.store.claim(identity)) === "already-owned") {
      summary.skippedClaimed += 1;
      return;
    }

    // R1 at send time: the item may have been paid between selection and now.
    if (await this.repo.isPaid(item.userId, item.target)) {
      await this.store.finalize(identity, "SKIPPED");
      summary.skippedPaid += 1;
      return;
    }

    const result = await this.provider.send({
      channel: "WHATSAPP",
      destination: item.destination,
      body: formatReminderMessage(item, windowDays),
    });

    if (result.ok) {
      await this.store.finalize(identity, "SENT");
      summary.sent += 1;
    } else {
      await this.store.finalize(identity, "FAILED", result.errorCode);
      summary.failed += 1;
    }
  }
}
