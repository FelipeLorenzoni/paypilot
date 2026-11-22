const ISO_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * Format a `YYYY-MM` month as `"July 2026"` by string parsing — no `Date`
 * construction and no locale data, so the label never shifts with the process
 * timezone or the runtime's ICU build. Malformed input is returned unchanged.
 */
export function formatMonth(monthIso: string): string {
  const match = ISO_MONTH.exec(monthIso);
  if (!match) {
    return monthIso;
  }
  const [, year, month] = match;
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}
