import { toAmountNumber, toDateString } from "../common/ledger-money-date";

/** Public-safe credit-card response. */
export interface CreditCardResponse {
  id: string;
  label: string;
  closingDay: number;
  dueDay: number;
  creditLimitMinor: number | null;
  isActive: boolean;
  createdAt: string; // ISO UTC
  updatedAt: string; // ISO UTC
}

/** The persisted credit-card row this mapper consumes. */
export interface CreditCardRow {
  id: string;
  userId: string;
  label: string;
  closingDay: number;
  dueDay: number;
  creditLimitMinor: bigint | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Public-safe response for a generated CARD ledger transaction. */
export interface CardTransactionResponse {
  id: string;
  amountMinor: number;
  currency: string;
  invoiceCycle: string; // YYYY-MM (closing month)
  dueDate: string; // YYYY-MM-DD
  installmentSeq: number;
  installmentTotal: number;
  description: string;
  category: string | null;
}

/** The persisted CARD transaction row this mapper consumes. */
export interface CardTransactionRow {
  id: string;
  amountMinor: bigint;
  currency: string;
  transactionDate: Date;
  invoiceCycle: string | null;
  installmentSeq: number | null;
  installmentTotal: number | null;
  description: string;
  categoryLabel: string | null;
}

export function toCreditCardResponse(row: CreditCardRow): CreditCardResponse {
  return {
    id: row.id,
    label: row.label,
    closingDay: row.closingDay,
    dueDay: row.dueDay,
    creditLimitMinor:
      row.creditLimitMinor === null
        ? null
        : toAmountNumber(row.creditLimitMinor),
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Map a generated CARD ledger row to its API response. `dueDate` is derived
 * directly from the row's `transactionDate` — the design stores a CARD
 * `transactionDate` = the invoice cycle due date, so the mapper never recomputes
 * it from closing/due-day context (it has no card context here).
 */
export function toCardTransactionResponse(
  row: CardTransactionRow,
): CardTransactionResponse {
  return {
    id: row.id,
    amountMinor: toAmountNumber(row.amountMinor),
    currency: row.currency,
    invoiceCycle: row.invoiceCycle ?? "",
    dueDate: toDateString(row.transactionDate),
    installmentSeq: row.installmentSeq ?? 0,
    installmentTotal: row.installmentTotal ?? 0,
    description: row.description,
    category: row.categoryLabel,
  };
}
