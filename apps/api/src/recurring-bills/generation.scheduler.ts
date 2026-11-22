import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { BusinessCalendar } from "../common/business-calendar";
import { GenerationService } from "./generation.service";

/**
 * Hourly UTC tick (app-timezone). The first tick inside a new business month
 * generates it, in any business timezone and across DST; every later tick is
 * an R3 no-op. Never the server's implicit timezone.
 */
export const GENERATION_TICK_CRON_UTC = "0 * * * *";

/**
 * In-process scheduler for monthly generation. **Non-production-grade**: in a
 * multi-instance deploy every instance fires its own cron; this is safe ONLY
 * because the DB-level `(recurringBillId, periodKey)` uniqueness is the source
 * of truth (overlapping runs converge to one row) — no in-memory lock is used.
 * BullMQ/Redis are intentionally out of scope.
 *
 * Runs hourly (not just on the 1st) so a missed tick still generates the
 * current period, and the period is the business month from the
 * {@link BusinessCalendar} — idempotency makes the extra runs harmless (they
 * report `skipped`).
 */
@Injectable()
export class GenerationScheduler {
  private readonly logger = new Logger(GenerationScheduler.name);

  constructor(
    private readonly calendar: BusinessCalendar,
    private readonly generation: GenerationService,
  ) {}

  @Cron(GENERATION_TICK_CRON_UTC, { timeZone: "UTC" })
  async runScheduledGeneration(): Promise<void> {
    const period = this.calendar.month();
    this.logger.debug(`scheduled generation starting for period=${period}`);
    await this.generation.generateForPeriod(period);
  }
}
