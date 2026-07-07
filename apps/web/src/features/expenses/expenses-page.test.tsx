import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseView, Paginated } from "@paypilot/shared";
import { ApiError, type ApiResult } from "../../lib/api/api-error";
import { ExpensesPage } from "./expenses-page";

const listExpenses =
  vi.fn<(query: unknown) => Promise<ApiResult<Paginated<ExpenseView>>>>();

vi.mock("../../lib/api/expenses", () => ({
  listExpenses: (query: unknown): Promise<ApiResult<Paginated<ExpenseView>>> =>
    listExpenses(query),
}));

function expense(overrides: Partial<ExpenseView> = {}): ExpenseView {
  return {
    id: "exp-1",
    amountMinor: 123456,
    currency: "BRL",
    expenseDate: "2026-03-10",
    description: "Supermarket",
    category: "Groceries",
    type: "EXPENSE",
    source: "MANUAL",
    createdAt: "2026-03-10T12:00:00.000Z",
    updatedAt: "2026-03-10T12:00:00.000Z",
    ...overrides,
  };
}

function pageOf(
  data: ExpenseView[],
  meta = { page: 1, pageSize: 20, total: data.length },
): ApiResult<Paginated<ExpenseView>> {
  return { ok: true, data: { data, meta } };
}

beforeEach(() => {
  listExpenses.mockReset();
});

describe("ExpensesPage", () => {
  it("shows a loading state while the list is pending", () => {
    listExpenses.mockReturnValue(new Promise(() => undefined));
    render(<ExpensesPage />);
    expect(screen.getByRole("status")).toBeDefined();
  });

  it("shows the empty state with guidance when there are no expenses", async () => {
    listExpenses.mockResolvedValue(pageOf([]));
    render(<ExpensesPage />);
    await waitFor(() =>
      expect(screen.getByText("No expenses yet")).toBeDefined(),
    );
  });

  it("shows a retryable error state with the requestId on failure", async () => {
    listExpenses
      .mockResolvedValueOnce({
        ok: false,
        error: new ApiError({
          code: "INTERNAL_ERROR",
          message: "boom",
          requestId: "req-exp-1",
        }),
      })
      .mockResolvedValueOnce(pageOf([expense()]));
    render(<ExpensesPage />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("req-exp-1");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Supermarket")).toBeDefined());
    expect(listExpenses).toHaveBeenCalledTimes(2);
  });

  it("renders formatted amounts and dates in a table", async () => {
    listExpenses.mockResolvedValue(
      pageOf([
        expense(),
        expense({
          id: "exp-2",
          amountMinor: 999,
          expenseDate: "2026-01-05",
          description: "Coffee",
          category: null,
        }),
      ]),
    );
    render(<ExpensesPage />);

    await waitFor(() => expect(screen.getByRole("table")).toBeDefined());
    for (const header of ["Date", "Description", "Category", "Amount"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeDefined();
    }
    expect(screen.getByText("R$ 1.234,56")).toBeDefined();
    expect(screen.getByText("10/03/2026")).toBeDefined();
    expect(screen.getByText("R$ 9,99")).toBeDefined();
    expect(screen.getByText("05/01/2026")).toBeDefined();
    expect(screen.getByText("Coffee")).toBeDefined();
  });

  it("fetches the next page when pagination advances", async () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      expense({ id: `exp-${i}`, description: `Expense ${i}` }),
    );
    listExpenses.mockResolvedValue(
      pageOf(rows, { page: 1, pageSize: 20, total: 40 }),
    );
    render(<ExpensesPage />);
    await waitFor(() => expect(screen.getByRole("table")).toBeDefined());
    expect(listExpenses).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(listExpenses).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 }),
    );
  });
});
