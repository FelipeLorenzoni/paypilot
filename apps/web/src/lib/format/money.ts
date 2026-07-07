/**
 * Deterministic money rendering from integer minor units — string-based manual
 * grouping (the api's reminder-formatter algorithm), no floats, no locale data.
 */
export function formatMoney(amountMinor: number, currency: "BRL"): string {
  void currency; // BRL only (MVP); the parameter keeps currency explicit at call sites.
  if (!Number.isSafeInteger(amountMinor)) {
    throw new Error("Invalid amount: expected a safe integer of minor units");
  }
  const negative = amountMinor < 0;
  const absolute = Math.abs(amountMinor);
  const cents = String(absolute % 100).padStart(2, "0");
  const units = String(Math.trunc(absolute / 100));
  const grouped = units.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}R$ ${grouped},${cents}`;
}
