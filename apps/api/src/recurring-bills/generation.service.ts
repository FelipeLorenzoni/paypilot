import { Injectable, Logger } from "@nestjs/common";
import { toDateOnly, toDateString } from "../common/ledger-money-date";
import { PrismaService } from "../prisma/prisma.service";
import { clampDay, isEligible } from "./generation.helpers";
import { RecurringBillsRepository } from "./recurring-bills.repository";

const PRISMA_UNIQUE_VIOLATION = "P2002";

/** Per-run outcome. Counts only — never exposes per-user data (R9.5). */
export interface GenerationSummary {
  period: string; // YYYY-MM
  created: number;
  skipped: number; // already generated (unique conflict) or duplicate
  failed: number;
}

/**
 * Idempotent monthly generation of ledger transactions from recurring bills.
 * DB-level uniqueness on `(recurringBillId, periodKey)` is the source of truth
 * for R3 (no duplicate monthly transactions); a unique violation is treated as
 * "already generated" and never mutates the existing row. No in-memory lock is
 * relied on — concurrent/overlapping runs converge to exactly one row.
 */
@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: RecurringBillsRepository,
  ) {}

  async generateForPeriod(period: string): Promise<GenerationSummary> {
    const summary: GenerationSummary = {
      period,
      created: 0,
      skipped: 0,
      failed: 0,
    };

    const bills = await this.repo.findActiveForGeneration();
    for (const bill of bills) {
      const generatedDate = clampDay(bill.dayOfMonth, period);
      const eligible = isEligible(
        toDateString(bill.startDate),
        bill.endDate ? toDateString(bill.endDate) : null,
        generatedDate,
      );
      if (!eligible) {
        continue; // inactive/out-of-window → zero for this bill
      }

      try {
        await this.prisma.transaction.create({
          data: {
            userId: bill.userId,
            type: "EXPENSE",
            source: "RECURRING",
            recurringBillId: bill.id,
            periodKey: period,
            amountMinor: bill.amountMinor,
            currency: bill.currency,
            transactionDate: toDateOnly(generatedDate),
            description: bill.description,
            categoryLabel: bill.categoryLabel,
          },
        });
        summary.created += 1;
      } catch (error) {
        if (this.isUniqueViolation(error)) {
          // Already generated for this (bill, period) — idempotent skip.
          summary.skipped += 1;
        } else {
          summary.failed += 1;
          this.logger.error(
            `generation failed for bill ${bill.id} period ${period}`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    }

    // Hourly ticks are mostly no-ops: only runs that changed something or
    // failed are worth an info line (app-timezone).
    const message = `generation period=${period} created=${summary.created} skipped=${summary.skipped} failed=${summary.failed}`;
    if (summary.created > 0 || summary.failed > 0) {
      this.logger.log(message);
    } else {
      this.logger.debug(message);
    }
    return summary;
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
