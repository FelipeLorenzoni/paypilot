import type { DueStatus } from "@paypilot/shared";
import { isIsoCalendarDate } from "../../common/is-iso-date.validator";

/**
 * The single due-status rule (requirements 4.2, 8.8; research.md D9). Pure and
 * clock-free: `today` is the UTC calendar date of the injected clock. Date-only
 * `YYYY-MM-DD` strings compare correctly as strings once validated.
 */
export function dueStatus(
  dueDate: string,
  today: string,
  paid: boolean,
): DueStatus {
  for (const value of [dueDate, today]) {
    if (!isIsoCalendarDate(value)) {
      throw new Error(`Invalid date (expected YYYY-MM-DD): ${value}`);
    }
  }
  if (paid) return "PAID";
  return dueDate < today ? "OVERDUE" : "DUE";
}
