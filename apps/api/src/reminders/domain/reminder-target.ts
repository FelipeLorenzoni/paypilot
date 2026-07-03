/**
 * Canonical reminder target identity (requirement 1.7): one stable
 * `targetType` + `targetKey` shared by paid markers and reminder deliveries.
 * Keys are SERVER-derived only — never accepted from clients as opaque
 * strings; the typed constituent parts are validated here and carried as
 * typed FK columns for referential integrity.
 */

export type ReminderTargetType = "RECURRING_TRANSACTION" | "CARD_INVOICE";

export interface ReminderTarget {
  targetType: ReminderTargetType;
  /** Canonical key: `txn:<transactionId>` | `card:<creditCardId>:<cycle>`. */
  targetKey: string;
  transactionId: string | null;
  creditCardId: string | null;
  invoiceCycle: string | null;
}

/** One reminder-eligible item selected for evaluation. */
export interface DueItem {
  target: ReminderTarget;
  userId: string;
  /** E.164 destination from the user's reminder settings. */
  destination: string;
  dueDate: string; // YYYY-MM-DD
  description: string; // bill description or card label
  amountMinor: number; // invoice = SUM of its rows
  currency: string; // BRL (MVP)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CYCLE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Identity of an already-generated `source = RECURRING` ledger row. */
export function recurringTarget(transactionId: string): ReminderTarget {
  if (!UUID.test(transactionId)) {
    throw new Error("Invalid transaction id for recurring target");
  }
  return {
    targetType: "RECURRING_TRANSACTION",
    targetKey: `txn:${transactionId}`,
    transactionId,
    creditCardId: null,
    invoiceCycle: null,
  };
}

/** Invoice-level identity: one per (card, cycle) — covers the whole invoice. */
export function cardInvoiceTarget(
  creditCardId: string,
  invoiceCycle: string,
): ReminderTarget {
  if (!UUID.test(creditCardId)) {
    throw new Error("Invalid card id for card invoice target");
  }
  if (!CYCLE.test(invoiceCycle)) {
    throw new Error("Invalid invoice cycle (expected YYYY-MM)");
  }
  return {
    targetType: "CARD_INVOICE",
    targetKey: `card:${creditCardId}:${invoiceCycle}`,
    transactionId: null,
    creditCardId,
    invoiceCycle,
  };
}
