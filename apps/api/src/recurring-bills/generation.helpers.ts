const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Number of days in the calendar month of a `"YYYY-MM"` period (UTC). */
function daysInMonth(period: string): number {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7)); // 1-based
  // Day 0 of the *next* month (1-based `month`) is the last day of `month`.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Generated transaction date for a bill in a period, as `"YYYY-MM-DD"`. The
 * day-of-month is clamped to the last day of the target month so a `dayOfMonth`
 * of 31 lands on 28/29/30 in short months (requirement R7).
 */
export function clampDay(dayOfMonth: number, period: string): string {
  if (!PERIOD.test(period)) {
    throw new Error(`Invalid period (expected YYYY-MM): ${period}`);
  }
  const day = Math.min(dayOfMonth, daysInMonth(period));
  return `${period}-${String(day).padStart(2, "0")}`;
}

/**
 * Eligibility for a (bill, period) is evaluated against the **generated date**:
 * the bill is eligible iff `startDate <= generatedDate` and, when `endDate` is
 * set, `generatedDate <= endDate`. All inputs are date-only `"YYYY-MM-DD"`
 * strings, which compare correctly lexicographically (no timezone involved).
 * Boundaries are inclusive (requirement R8).
 */
export function isEligible(
  startDate: string,
  endDate: string | null,
  generatedDate: string,
): boolean {
  if (generatedDate < startDate) {
    return false;
  }
  if (endDate !== null && generatedDate > endDate) {
    return false;
  }
  return true;
}
