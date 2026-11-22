/**
 * Documented reminder constants (design.md — hard-coded for the MVP, the
 * csv-import limits precedent; promote to validated config in a later spec if
 * needed).
 */

/**
 * Reminder windows in days before the due date: D-3 (heads-up) and D-0 (due
 * today). A window fires only when `dueDate − window == today` (business
 * date) — missed windows are silently skipped (catch-up is exact-match-only).
 */
export const REMINDER_WINDOWS_DAYS_BEFORE: readonly number[] = [3, 0];

/**
 * Evaluation schedule (app-timezone): an hourly UTC tick at minute 15 that
 * evaluates only while the business-timezone hour is {@link REMINDER_LOCAL_HOUR},
 * i.e. once per business day at 09:15 local. By then that day's hourly
 * recurring-bills generation ticks have run, so the current period's
 * occurrences exist. 09:00 lies outside every DST transition window, so the
 * gate matches exactly once a day.
 */
export const REMINDER_TICK_CRON_UTC = "15 * * * *";

/** Business-timezone hour (0–23) at which the daily evaluation runs. */
export const REMINDER_LOCAL_HOUR = 9;

/**
 * A PENDING delivery older than this is considered a crashed claim and becomes
 * re-claimable (one daily run later). Residual risk documented in design.md:
 * with a REAL provider a lost send outcome could repeat once — out of scope in
 * the MVP (stub/log providers only).
 */
export const STALE_CLAIM_HOURS = 12;

/** E.164 destination format for reminder settings. */
export const PHONE_E164_REGEX = /^\+[1-9]\d{7,14}$/;
