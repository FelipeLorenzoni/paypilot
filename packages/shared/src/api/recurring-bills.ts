import type { PageQuery } from "./pagination";

/** Recurring bill as returned by `GET /recurring-bills` (the api's `RecurringBillResponse`). */
export interface RecurringBillView {
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

/** Query accepted by `GET /recurring-bills` (pagination + optional active filter). */
export interface RecurringBillListQuery extends PageQuery {
  active?: boolean;
}
