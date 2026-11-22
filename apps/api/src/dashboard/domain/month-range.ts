import { OVERDUE_LOOKBACK_MONTHS } from "../dashboard.constants";

/**
 * Pure month-boundary logic (requirement 8.4). The only place the dashboard
 * computes month boundaries: every value is a `YYYY-MM` or `YYYY-MM-DD` string
 * derived through UTC getters, so results are identical under any process
 * timezone.
 */

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

function parseMonth(month: string): { year: number; month: number } {
  const match = MONTH.exec(month);
  if (!match) {
    throw new Error(`Invalid month (expected YYYY-MM): ${month}`);
  }
  return { year: Number(match[1]), month: Number(match[2]) };
}

function formatMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** UTC calendar month of an instant: `"2026-07"`. */
export function monthOf(now: Date): string {
  return formatMonth(now.getUTCFullYear(), now.getUTCMonth() + 1);
}

/** Inclusive date-only boundaries of a `YYYY-MM` month (UTC, short-month safe). */
export function monthRange(month: string): { start: string; end: string } {
  const parsed = parseMonth(month);
  // Day 0 of the next month (1-based `month`) is the last day of `month`.
  const lastDay = new Date(Date.UTC(parsed.year, parsed.month, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

/** The `YYYY-MM` month `offset` calendar months after `month` (negative = before). */
export function shiftMonth(month: string, offset: number): string {
  const parsed = parseMonth(month);
  const zeroBased = parsed.year * 12 + (parsed.month - 1) + offset;
  return formatMonth(Math.floor(zeroBased / 12), (zeroBased % 12) + 1);
}

/** First month of the overdue look-back window for `month` (research.md D9). */
export function lookbackFrom(month: string): string {
  return shiftMonth(month, -OVERDUE_LOOKBACK_MONTHS);
}
