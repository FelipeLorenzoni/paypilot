import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { CLOCK, type Clock } from "../common/clock";
import { deriveCurrentPeriod } from "./generation.helpers";
import { GenerationService } from "./generation.service";

/**
 * In-process scheduler for monthly generation. **Non-production-grade**: in a
 * multi-instance deploy every instance fires its own cron; this is safe ONLY
 * because the DB-level `(recurringBillId, periodKey)` uniqueness is the source
 * of truth (overlapping runs converge to one row) — no in-memory lock is used.
 * BullMQ/Redis are intentionally out of scope.
 *
 * Runs daily (not just on the 1st) so a missed day still generates the current
 * period, and the period is derived from the UTC clock — idempotency makes the
 * extra daily runs harmless (they report `skipped`).
 */
@Injectable()
export class GenerationScheduler {
  private readonly logger = new Logger(GenerationScheduler.name);

  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly generation: GenerationService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async runScheduledGeneration(): Promise<void> {
    const period = deriveCurrentPeriod(this.clock);
    this.logger.log(`scheduled generation starting for period=${period}`);
    await this.generation.generateForPeriod(period);
  }
}
