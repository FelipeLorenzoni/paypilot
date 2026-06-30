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

// Money/date helpers live in common/ (shared with recurring-bills) and are
// re-exported here so existing expenses imports keep working.
export {
  toAmountBigInt,
  toAmountNumber,
  toDateOnly,
  toDateString,
} from "../common/ledger-money-date";
import { toAmountNumber, toDateString } from "../common/ledger-money-date";

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
