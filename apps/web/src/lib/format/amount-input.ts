// Accepted user forms (pt-BR product; dot-separated triplets are grouping):
//   "1234"        → 123400   (whole units)
//   "1.234,56"    → 123456   (pt-BR grouping + comma decimals)
//   "1.234"       → 123400   (pt-BR grouping, no decimals)
//   "1234,56"     → 123456   (comma decimals)
//   "1234.56"     → 123456   (dot decimals, max two digits)
const GROUPED_PTBR = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/;
const COMMA_DECIMAL = /^(\d+)(?:,(\d{1,2}))?$/;
const DOT_DECIMAL = /^(\d+)\.(\d{1,2})$/;

/**
 * Parse user-friendly decimal text into integer minor units, or null when the
 * input is not a valid non-negative amount. Digits are assembled as strings —
 * no floating-point arithmetic touches the amount.
 */
export function parseAmountInput(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }

  const match =
    GROUPED_PTBR.exec(trimmed) ??
    COMMA_DECIMAL.exec(trimmed) ??
    DOT_DECIMAL.exec(trimmed);
  if (!match) {
    return null;
  }

  const units = (match[1] ?? "").replaceAll(".", "");
  const cents = (match[2] ?? "").padEnd(2, "0");
  const amountMinor = Number(`${units}${cents}`);
  return Number.isSafeInteger(amountMinor) ? amountMinor : null;
}
