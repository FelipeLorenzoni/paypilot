import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { BusinessCalendar } from "../common/business-calendar";
import { ReminderEvaluationService } from "./reminder-evaluation.service";
import {
  REMINDER_LOCAL_HOUR,
  REMINDER_TICK_CRON_UTC,
} from "./reminder.constants";

/**
 * In-process scheduler (recurring-bills precedent — non-production-grade
 * for multi-instance deploys, and safe for the same reason: the DB-level
 * claim on `reminder_deliveries` is the concurrency source of truth, so
 * overlapping instances converge to one send per identity; no in-memory lock).
 * Ticks hourly in UTC and evaluates once per business day, on the tick inside
 * {@link REMINDER_LOCAL_HOUR} (see `reminder.constants.ts`). "Today" is the
 * business date from the {@link BusinessCalendar} — never server-local time.
 */
@Injectable()
export class RemindersScheduler {
  private readonly logger = new Logger(RemindersScheduler.name);

  constructor(
    private readonly calendar: BusinessCalendar,
    private readonly evaluation: ReminderEvaluationService,
  ) {}

  @Cron(REMINDER_TICK_CRON_UTC, { timeZone: "UTC" })
  async runScheduledEvaluation(): Promise<void> {
    if (this.calendar.hour() !== REMINDER_LOCAL_HOUR) {
      return;
    }
    const today = this.calendar.today();
    this.logger.log(`scheduled reminder evaluation starting for ${today}`);
    await this.evaluation.evaluate(today);
  }
}
