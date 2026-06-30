// Shared money/date boundary helpers for ledger rows. Used by both the manual
// expenses and recurring-bills mappers so the BigInt<->number guard and the
// date-only (no-timezone-shift) conversion have a single tested source.

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

/** DB `bigint` minor units → JS number, guarded against precision loss. */
export function toAmountNumber(value: bigint): number {
  if (value > MAX_SAFE || value < MIN_SAFE) {
    throw new Error("amountMinor exceeds the safe integer range");
  }
  return Number(value);
}

/** JS number minor units → DB `bigint`, rejecting non-safe integers. */
export function toAmountBigInt(value: number): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new Error("amountMinor must be a safe integer");
  }
  return BigInt(value);
}

/** `YYYY-MM-DD` → date-only Date at UTC midnight (no timezone shift). */
export function toDateOnly(yyyyMmDd: string): Date {
  return new Date(`${yyyyMmDd}T00:00:00.000Z`);
}

/** date-only Date → `YYYY-MM-DD` (UTC calendar date). */
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
