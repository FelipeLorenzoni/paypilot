/** Public-safe expense response (API shape; maps generic ledger field names). */
export interface ExpenseResponse {
  id: string;
  amountMinor: number;
  currency: string;
  expenseDate: string; // YYYY-MM-DD
  description: string;
  category: string | null;
  type: "EXPENSE";
  source: "MANUAL";
  createdAt: string; // ISO UTC
  updatedAt: string; // ISO UTC
}

/** The persisted ledger row shape this mapper consumes. */
export interface TransactionRow {
  id: string;
  userId: string;
  type: string;
  source: string;
  amountMinor: bigint;
  currency: string;
  transactionDate: Date;
  description: string;
  categoryLabel: string | null;
  createdAt: Date;
  updatedAt: Date;
}

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

/** Map a persisted ledger row to the API expense response. */
export function toExpenseResponse(row: TransactionRow): ExpenseResponse {
  return {
    id: row.id,
    amountMinor: toAmountNumber(row.amountMinor),
    currency: row.currency,
    expenseDate: toDateString(row.transactionDate),
    description: row.description,
    category: row.categoryLabel,
    type: row.type as "EXPENSE",
    source: row.source as "MANUAL",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
