// Pure invoice-assignment domain (financial-rules R4). Framework-free and with
// NO system clock read: everything is a deterministic function of the explicit
// client-provided purchase date and the card's closing/due day (date-only
// string math, no timezone dependence).

import { isIsoCalendarDate } from "../../common/is-iso-date.validator";

const CYCLE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Days in the calendar month of a `YYYY-MM` value (UTC). */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month (1-based `month`) is the last day of `month`.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `"YYYY-MM"` for the month `offset` months after `year`/`month` (1-based). */
function shiftMonth(year: number, month: number, offset: number): string {
  const zeroBased = year * 12 + (month - 1) + offset;
  const y = Math.floor(zeroBased / 12);
  const m = (zeroBased % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/**
 * Assign a purchase to its invoice cycle (the **closing month** `YYYY-MM`).
 * On or before the effective closing day → the purchase month's cycle; after it
 * → the next month (rolling the year at December). The closing day is clamped to
 * the month length so e.g. `closingDay=31` behaves in February.
 */
export function assignCycle(purchaseDate: string, closingDay: number): string {
  if (!isIsoCalendarDate(purchaseDate)) {
    throw new Error(
      `Invalid purchaseDate (expected YYYY-MM-DD): ${purchaseDate}`,
    );
  }
  const year = Number(purchaseDate.slice(0, 4));
  const month = Number(purchaseDate.slice(5, 7));
  const day = Number(purchaseDate.slice(8, 10));
  const effectiveClosing = Math.min(closingDay, daysInMonth(year, month));
  return day <= effectiveClosing
    ? `${year}-${String(month).padStart(2, "0")}`
    : shiftMonth(year, month, 1);
}

/**
 * Due date (`YYYY-MM-DD`) for a cycle. If `dueDay > closingDay` the due date is
 * in the cycle (closing) month; otherwise it rolls to the following month. The
 * day is clamped to the target month's length.
 */
export function dueDate(
  cycle: string,
  closingDay: number,
  dueDay: number,
): string {
  if (!CYCLE.test(cycle)) {
    throw new Error(`Invalid cycle (expected YYYY-MM): ${cycle}`);
  }
  const year = Number(cycle.slice(0, 4));
  const month = Number(cycle.slice(5, 7));
  const dueMonth = dueDay > closingDay ? cycle : shiftMonth(year, month, 1);
  const dueYear = Number(dueMonth.slice(0, 4));
  const dueMon = Number(dueMonth.slice(5, 7));
  const day = Math.min(dueDay, daysInMonth(dueYear, dueMon));
  return `${dueMonth}-${String(day).padStart(2, "0")}`;
}
