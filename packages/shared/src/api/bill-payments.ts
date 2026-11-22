/**
 * Product-level paid state of a payable item (`PUT /bill-payments`).
 * Implemented by the api and consumed by the web client.
 *
 * The canonical `targetKey` is always derived server-side from the validated
 * identity parts; clients send the parts, never the key.
 */
export type PayableTargetType = "RECURRING_TRANSACTION" | "CARD_INVOICE";

/** Mark (`paid: true`) or unmark (`paid: false`) one payable item. */
export interface SetBillPaymentRequest {
  targetType: PayableTargetType;
  transactionId?: string; // RECURRING_TRANSACTION
  creditCardId?: string; // CARD_INVOICE
  invoiceCycle?: string; // CARD_INVOICE, YYYY-MM
  paid: boolean;
  /** YYYY-MM-DD, not after today; only with `paid: true`. Omitted → today. */
  paidOn?: string;
}

export interface BillPaymentView {
  targetType: PayableTargetType;
  targetKey: string;
  paid: boolean;
  paidOn: string | null; // YYYY-MM-DD
  recordedAt: string | null; // ISO UTC
}
