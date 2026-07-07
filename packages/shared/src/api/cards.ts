/** Credit card as returned by `GET /credit-cards` (the api's `CreditCardResponse`). */
export interface CreditCardView {
  id: string;
  label: string;
  closingDay: number;
  dueDay: number;
  creditLimitMinor: number | null;
  isActive: boolean;
  createdAt: string; // ISO UTC
  updatedAt: string; // ISO UTC
}

/**
 * Generated CARD ledger transaction line inside an invoice (the api's
 * `CardTransactionResponse`).
 */
export interface InvoiceTransactionView {
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

/**
 * Derived invoice returned by `GET /credit-cards/:cardId/invoices/:cycle`
 * (no stored invoice entity — computed from the card's ledger rows).
 */
export interface InvoiceView {
  cardId: string;
  cycle: string; // YYYY-MM (closing month)
  dueDate: string; // YYYY-MM-DD
  totalMinor: number;
  transactions: InvoiceTransactionView[];
}
