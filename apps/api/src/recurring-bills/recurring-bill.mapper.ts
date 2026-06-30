import { toAmountNumber, toDateString } from "../common/ledger-money-date";

/** Public-safe recurring-bill response (API shape; maps generic field names). */
export interface RecurringBillResponse {
  id: string;
  amountMinor: number;
  currency: string;
  dayOfMonth: number;
  description: string;
  category: string | null;
  startDate: string; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD
  isActive: boolean;
  createdAt: string; // ISO UTC
  updatedAt: string; // ISO UTC
}

/** The persisted recurring-bill row shape this mapper consumes. */
export interface RecurringBillRow {
  id: string;
  userId: string;
  amountMinor: bigint;
  currency: string;
  dayOfMonth: number;
  description: string;
  categoryLabel: string | null;
  startDate: Date;
  endDate: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Map a persisted recurring-bill row to the API response. */
export function toRecurringBillResponse(
  row: RecurringBillRow,
): RecurringBillResponse {
  return {
    id: row.id,
    amountMinor: toAmountNumber(row.amountMinor),
    currency: row.currency,
    dayOfMonth: row.dayOfMonth,
    description: row.description,
    category: row.categoryLabel,
    startDate: toDateString(row.startDate),
    endDate: row.endDate ? toDateString(row.endDate) : null,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
