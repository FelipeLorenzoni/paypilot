/**
 * Documented dashboard constants (design.md / research.md D9 — hard-coded for
 * the MVP, the reminders constants precedent).
 */

/**
 * Whole calendar months before the requested month whose unpaid RECURRING and
 * CARD items are carried over into the due list as OVERDUE. Bounded because
 * paid markers only exist from `reminders` onward: an unbounded window would
 * flag every historical bill as overdue until `bill-payments` lands.
 */
export const OVERDUE_LOOKBACK_MONTHS = 3;
