import { REMINDER_WINDOWS_DAYS_BEFORE } from "../reminder.constants";

/**
 * Pure window/date logic (requirements 1.2, 1.5, 8.1, 8.2). No clock read —
 * "today" is an input (the UTC calendar date of `Clock.now()`, the
 * recurring-bills `deriveCurrentPeriod` precedent). All arithmetic happens on
 * `YYYY-MM-DD` strings via UTC getters, so results are identical under any
 * process timezone.
 */

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

function toUtcMillis(dateIso: string): number {
  if (!DATE_ISO.test(dateIso)) {
    throw new Error(`Invalid date (expected YYYY-MM-DD): ${dateIso}`);
  }
  const year = Number(dateIso.slice(0, 4));
  const month = Number(dateIso.slice(5, 7));
  const day = Number(dateIso.slice(8, 10));
  const millis = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(millis);
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() + 1 !== month ||
    roundTrip.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${dateIso}`);
  }
  return millis;
}

/** `dateIso + days` as a `YYYY-MM-DD` string (UTC arithmetic, tz-immune). */
export function addDays(dateIso: string, days: number): string {
  const date = new Date(toUtcMillis(dateIso) + days * 86_400_000);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The reminder windows matching `todayUtc` for a due date: exactly those `w`
 * where `today + w == dueDate`. Past windows never match (catch-up is
 * exact-match-only per design).
 */
export function windowsFor(dueDate: string, todayUtc: string): number[] {
  toUtcMillis(dueDate); // validate both inputs up front
  return REMINDER_WINDOWS_DAYS_BEFORE.filter(
    (w) => addDays(todayUtc, w) === dueDate,
  );
}
