/**
 * Documented reminder constants (design.md — hard-coded for the MVP, the
 * csv-import limits precedent; promote to validated config in a later spec if
 * needed).
 */

/**
 * Reminder windows in days before the due date: D-3 (heads-up) and D-0 (due
 * today). A window fires only when `dueDate − window == today` (UTC calendar
 * date) — missed windows are silently skipped (catch-up is exact-match-only).
 */
export const REMINDER_WINDOWS_DAYS_BEFORE: readonly number[] = [3, 0];

/**
 * Daily evaluation schedule: 12:00 UTC (09:00 América/São Paulo — a civil
 * reminder hour, hours after the 01:00 UTC recurring-bills generation run so
 * the current period's occurrences already exist).
 */
export const REMINDER_CRON_UTC = "0 12 * * *";

/**
 * A PENDING delivery older than this is considered a crashed claim and becomes
 * re-claimable (one daily run later). Residual risk documented in design.md:
 * with a REAL provider a lost send outcome could repeat once — out of scope in
 * the MVP (stub/log providers only).
 */
export const STALE_CLAIM_HOURS = 12;

/** E.164 destination format for reminder settings. */
export const PHONE_E164_REGEX = /^\+[1-9]\d{7,14}$/;
