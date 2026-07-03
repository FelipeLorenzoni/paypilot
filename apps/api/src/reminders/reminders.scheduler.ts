import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { CLOCK, type Clock } from "../common/clock";
import { toDateString } from "../common/ledger-money-date";
import { ReminderEvaluationService } from "./reminder-evaluation.service";
import { REMINDER_CRON_UTC } from "./reminder.constants";

/**
 * In-process daily scheduler (recurring-bills precedent — non-production-grade
 * for multi-instance deploys, and safe for the same reason: the DB-level
 * claim on `reminder_deliveries` is the concurrency source of truth, so
 * overlapping instances converge to one send per identity; no in-memory lock).
 * Runs at 12:00 UTC (09:00 América/São Paulo), hours after the 01:00 UTC
 * generation run so the current period's occurrences exist. "Today" is the
 * UTC calendar date of the injected clock — never server-local time.
 */
@Injectable()
export class RemindersScheduler {
  private readonly logger = new Logger(RemindersScheduler.name);

  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly evaluation: ReminderEvaluationService,
  ) {}

  @Cron(REMINDER_CRON_UTC, { timeZone: "UTC" })
  async runScheduledEvaluation(): Promise<void> {
    const todayUtc = toDateString(this.clock.now());
    this.logger.log(`scheduled reminder evaluation starting for ${todayUtc}`);
    await this.evaluation.evaluate(todayUtc);
  }
}
