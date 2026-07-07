/** Manual expense as returned by `GET /expenses` (the api's `ExpenseResponse`). */
export interface ExpenseView {
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
