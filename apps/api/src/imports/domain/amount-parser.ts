// Pure amount parsing for CSV rows (untrusted input). Deterministic, integer
// math only. Two accepted textual forms (documented in the design):
//   - dot-decimal:  "1234.56", "1234", "0.5"        (no thousands separators)
//   - Brazilian:    "1.234,56", "1234,56", "1.234"  (dot thousands, comma decimal)
// Resolution order is deterministic: strict dot-decimal first, then Brazilian —
// so "1.234" (3 digits after a dot) is the BR thousands form = 1234.00.

const DOT_DECIMAL = /^\d+(\.\d{1,2})?$/;
const BRAZILIAN = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$|^\d+(,\d{1,2})?$/;

export type AmountParseResult =
  | { ok: true; amountMinor: number }
  | { ok: false; reason: "INVALID_AMOUNT_FORMAT" | "NON_POSITIVE_AMOUNT" };

/** Convert integer+fraction strings to minor units (2 decimal places, BRL). */
function toMinor(intPart: string, fracPart: string): number {
  const frac = fracPart.padEnd(2, "0");
  return Number(intPart) * 100 + Number(frac);
}

/**
 * Parse a CSV amount string to positive integer minor units. A leading `R$`
 * (with optional space) and surrounding whitespace are tolerated and stripped.
 * Values matching neither accepted form, exceeding two decimals, outside the
 * safe-integer range, or non-positive are rejected with a specific reason.
 */
export function parseAmount(raw: string): AmountParseResult {
  let value = raw.trim();
  const negative = value.startsWith("-");
  if (negative) {
    value = value.slice(1).trimStart();
  }
  value = value.replace(/^R\$\s?/i, "").trim();

  let minor: number;
  if (DOT_DECIMAL.test(value)) {
    const [intPart, fracPart = ""] = value.split(".");
    minor = toMinor(intPart as string, fracPart);
  } else if (BRAZILIAN.test(value)) {
    const [intWithThousands, fracPart = ""] = value.split(",");
    minor = toMinor((intWithThousands as string).replace(/\./g, ""), fracPart);
  } else {
    return { ok: false, reason: "INVALID_AMOUNT_FORMAT" };
  }

  if (!Number.isSafeInteger(minor)) {
    return { ok: false, reason: "INVALID_AMOUNT_FORMAT" };
  }
  if (negative || minor <= 0) {
    // Expenses-only MVP: zero/negative amounts are rejected as invalid rows.
    return { ok: false, reason: "NON_POSITIVE_AMOUNT" };
  }
  return { ok: true, amountMinor: minor };
}
