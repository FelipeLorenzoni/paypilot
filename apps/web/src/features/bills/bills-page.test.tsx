import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Paginated, RecurringBillView } from "@paypilot/shared";
import { ApiError, type ApiResult } from "../../lib/api/api-error";
import { BillsPage } from "./bills-page";

const listRecurringBills =
  vi.fn<(query: unknown) => Promise<ApiResult<Paginated<RecurringBillView>>>>();

vi.mock("../../lib/api/bills", () => ({
  listRecurringBills: (
    query: unknown,
  ): Promise<ApiResult<Paginated<RecurringBillView>>> =>
    listRecurringBills(query),
}));

function bill(overrides: Partial<RecurringBillView> = {}): RecurringBillView {
  return {
    id: "bill-1",
    amountMinor: 12000,
    currency: "BRL",
    dayOfMonth: 10,
    description: "Internet",
    category: "Utilities",
    startDate: "2026-01-01",
    endDate: null,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function pageOf(
  data: RecurringBillView[],
): ApiResult<Paginated<RecurringBillView>> {
  return {
    ok: true,
    data: { data, meta: { page: 1, pageSize: 20, total: data.length } },
  };
}

beforeEach(() => {
  listRecurringBills.mockReset();
});

describe("BillsPage", () => {
  it("shows a loading state while pending", () => {
    listRecurringBills.mockReturnValue(new Promise(() => undefined));
    render(<BillsPage />);
    expect(screen.getByRole("status")).toBeDefined();
  });

  it("renders bills with amount, day of month and active status", async () => {
    listRecurringBills.mockResolvedValue(
      pageOf([
        bill(),
        bill({
          id: "bill-2",
          description: "Old gym",
          amountMinor: 4590,
          dayOfMonth: 5,
          isActive: false,
        }),
      ]),
    );
    render(<BillsPage />);

    await waitFor(() => expect(screen.getByRole("table")).toBeDefined());
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Internet")).toBeDefined();
    expect(table.getByText("R$ 120,00")).toBeDefined();
    expect(table.getByText("R$ 45,90")).toBeDefined();
    expect(table.getByText("10")).toBeDefined();
    expect(table.getByText("5")).toBeDefined();
    expect(table.getByText("Active")).toBeDefined();
    expect(table.getByText("Inactive")).toBeDefined();
  });

  it("refetches with the active filter when it changes", async () => {
    listRecurringBills.mockResolvedValue(pageOf([bill()]));
    render(<BillsPage />);
    await waitFor(() => expect(screen.getByRole("table")).toBeDefined());
    expect(listRecurringBills).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      active: undefined,
    });

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Status"), "active");
    await waitFor(() =>
      expect(listRecurringBills).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 20,
        active: true,
      }),
    );
  });

  it("shows the empty state when there are no bills", async () => {
    listRecurringBills.mockResolvedValue(pageOf([]));
    render(<BillsPage />);
    await waitFor(() =>
      expect(screen.getByText("No recurring bills yet")).toBeDefined(),
    );
  });

  it("shows a retryable error state on failure", async () => {
    listRecurringBills.mockResolvedValue({
      ok: false,
      error: new ApiError({
        code: "NETWORK_ERROR",
        message: "offline",
        requestId: null,
      }),
    });
    render(<BillsPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });
});
