import { createMoney } from "@paypilot/shared";
import { isIsoCalendarDate } from "../../common/is-iso-date.validator";
import { parseAmount } from "./amount-parser";

// Pure per-row validation (untrusted CSV rows). Framework-free, no clock read.
// Stable reason codes surface in the import summary (`invalidRows[].reasonCode`)
// without echoing row contents.

export const ROW_REASON_CODES = [
  "MISSING_FIELD",
  "INVALID_DATE",
  "INVALID_AMOUNT_FORMAT",
  "NON_POSITIVE_AMOUNT",
  "UNSUPPORTED_CURRENCY",
  "FIELD_TOO_LONG",
] as const;
export type RowReasonCode = (typeof ROW_REASON_CODES)[number];

export interface RowCandidate {
  date: string; // YYYY-MM-DD
  amountMinor: number; // positive safe integer
  currency: "BRL";
  description: string; // trimmed original (normalization is only for the hash)
  category: string | null;
}

export type RowResult =
  | { ok: true; candidate: RowCandidate }
  | { ok: false; reasonCode: RowReasonCode };

const MAX_DESCRIPTION = 255;
const MAX_CATEGORY = 100;

/** Validate one parsed CSV record into a ledger candidate or a coded rejection. */
export function validateRow(raw: Record<string, string>): RowResult {
  const date = (raw.date ?? "").trim();
  const amount = (raw.amount ?? "").trim();
  const description = (raw.description ?? "").trim();
  const category = (raw.category ?? "").trim();
  const currency = (raw.currency ?? "").trim().toUpperCase();

  if (!date || !amount || !description) {
    return { ok: false, reasonCode: "MISSING_FIELD" };
  }
  if (!isIsoCalendarDate(date)) {
    return { ok: false, reasonCode: "INVALID_DATE" };
  }
  const parsed = parseAmount(amount);
  if (!parsed.ok) {
    return { ok: false, reasonCode: parsed.reason };
  }
  // Optional column: absent/empty defaults to BRL (MVP is BRL-only).
  if (currency && currency !== "BRL") {
    return { ok: false, reasonCode: "UNSUPPORTED_CURRENCY" };
  }
  if (description.length > MAX_DESCRIPTION || category.length > MAX_CATEGORY) {
    return { ok: false, reasonCode: "FIELD_TOO_LONG" };
  }

  // Single source of money validation (safe-integer + ISO-4217).
  createMoney(parsed.amountMinor, "BRL");

  return {
    ok: true,
    candidate: {
      date,
      amountMinor: parsed.amountMinor,
      currency: "BRL",
      description,
      category: category || null,
    },
  };
}
