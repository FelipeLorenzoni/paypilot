import { Inject, Injectable } from "@nestjs/common";
import type { MonthlySummaryView } from "@paypilot/shared";
import { CLOCK, type Clock } from "../common/clock";
import { toDateString } from "../common/ledger-money-date";
import { DashboardRepository } from "./dashboard.repository";
import {
  lookbackFrom,
  monthOf,
  monthRange,
  shiftMonth,
} from "./domain/month-range";
import { payableTargetKeys, summarizeMonth } from "./domain/summarize-month";

/**
 * Monthly summary use case (requirements 1.4, 8.1–8.7). Reads the injected
 * clock once, derives "today", the month and the look-back window as
 * date-only strings, runs the owner-scoped reads, and delegates every bit of
 * aggregation to the pure `summarizeMonth`. Its return type is the shared
 * contract, so the api and the web client cannot drift.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly repo: DashboardRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async getSummary(
    userId: string,
    month?: string,
  ): Promise<MonthlySummaryView> {
    const now = this.clock.now();
    const today = toDateString(now);
    const target = month ?? monthOf(now);
    const { start: monthStart, end: monthEnd } = monthRange(target);
    const lookbackStart = monthRange(lookbackFrom(target)).start;
    const lookbackEnd = monthRange(shiftMonth(target, -1)).end;

    const [rows, carryOverRows] = await Promise.all([
      this.repo.findMonthRows(userId, monthStart, monthEnd),
      this.repo.findPayableRows(userId, lookbackStart, lookbackEnd),
    ]);
    const markers = await this.repo.findPaidKeys(userId, [
      ...payableTargetKeys(rows),
      ...payableTargetKeys(carryOverRows),
    ]);

    return summarizeMonth({
      month: target,
      monthStart,
      monthEnd,
      today,
      rows,
      carryOverRows,
      markers,
    });
  }
}
