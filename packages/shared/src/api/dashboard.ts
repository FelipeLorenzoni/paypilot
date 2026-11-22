/**
 * Monthly summary returned by `GET /dashboard/summary`.
 *
 * Unlike the other contracts in this folder, this one is implemented by the
 * api (`DashboardService` declares it as its return type) **and** consumed by
 * the web client, so a rename on either side is a type-check failure.
 */
export type SummarySource = "MANUAL" | "RECURRING" | "CARD" | "IMPORTED";
export type DueTargetType = "RECURRING_TRANSACTION" | "CARD_INVOICE";

export interface SourceSubtotal {
  source: SummarySource;
  amountMinor: number; // 0 when the source has no rows this month
}

export interface CategorySubtotal {
  /** Exactly as stored; `null` is the single "uncategorized" bucket. */
  label: string | null;
  amountMinor: number;
}

/** All aggregates live inside a currency block — nothing sums across them. */
export interface CurrencySummary {
  currency: string; // ISO-4217, e.g. "BRL"
  totalMinor: number;
  bySource: SourceSubtotal[]; // always the four sources, in a stable order
  byCategory: CategorySubtotal[]; // amount descending
}

export type DueStatus = "OVERDUE" | "DUE" | "PAID";

export interface DueItemView {
  /** Canonical paid identity — the same one `PUT /reminders/paid` accepts. */
  targetType: DueTargetType;
  targetKey: string; // txn:<id> | card:<cardId>:<cycle>
  source: "RECURRING" | "CARD";
  description: string; // bill description | card label
  dueDate: string; // YYYY-MM-DD
  amountMinor: number; // a card invoice is the SUM of its rows
  currency: string;
  /** Computed server-side from the injected today + paid markers. */
  status: DueStatus;
  paidAt: string | null; // ISO UTC, null unless PAID
  paidOn: string | null; // YYYY-MM-DD payment date, null unless PAID
  /** Identity parts to send back to `PUT /bill-payments` (never the key). */
  transactionId: string | null; // RECURRING items
  creditCardId: string | null; // CARD items
  invoiceCycle: string | null; // CARD items, YYYY-MM
  /** True when the item belongs to an earlier month of the look-back window. */
  carriedOver: boolean;
}

/** Per-currency "how much is late / still to pay". */
export interface DueTotals {
  currency: string;
  overdueCount: number;
  overdueMinor: number;
  dueCount: number;
  dueMinor: number;
}

export interface MonthlySummaryView {
  month: string; // YYYY-MM
  monthStart: string; // YYYY-MM-DD
  monthEnd: string; // YYYY-MM-DD
  today: string; // YYYY-MM-DD — the browser never reads a clock
  /** False when the month has no rows in any source → the page's empty state. */
  hasActivity: boolean;
  /** Never empty: a month with no rows yields one zeroed BRL block. */
  currencies: CurrencySummary[];
  /** Month payable items + carried-over OVERDUE items; OVERDUE → DUE → PAID, then dueDate. */
  dueItems: DueItemView[];
  /** One entry per currency present in dueItems; empty when dueItems is empty. */
  dueTotals: DueTotals[];
  /** First month of the overdue look-back window, YYYY-MM. */
  overdueLookbackFrom: string;
}
