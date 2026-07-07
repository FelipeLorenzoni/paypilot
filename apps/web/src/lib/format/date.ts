const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Format a date-only `YYYY-MM-DD` string as `DD/MM/YYYY` by string slicing —
 * no `Date` construction, so the calendar date can never shift with the
 * process timezone. Malformed input is returned unchanged.
 */
export function formatDate(dateIso: string): string {
  const match = ISO_DATE.exec(dateIso);
  if (!match) {
    return dateIso;
  }
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}
