import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BillPaymentView,
  DueItemView,
  MonthlySummaryView,
  SetBillPaymentRequest,
} from "@paypilot/shared";
import { ApiError, type ApiResult } from "../../lib/api/api-error";
import { DashboardPage } from "./dashboard-page";

const getMonthlySummary = vi.fn<() => Promise<ApiResult<MonthlySummaryView>>>();

const setBillPayment =
  vi.fn<(body: SetBillPaymentRequest) => Promise<ApiResult<BillPaymentView>>>();

vi.mock("../../lib/api/bill-payments", () => ({
  setBillPayment: (
    body: SetBillPaymentRequest,
  ): Promise<ApiResult<BillPaymentView>> => setBillPayment(body),
}));

vi.mock("../../lib/api/dashboard", () => ({
  getMonthlySummary: (): Promise<ApiResult<MonthlySummaryView>> =>
    getMonthlySummary(),
}));

function dueItem(overrides: Partial<DueItemView>): DueItemView {
  return {
    targetType: "RECURRING_TRANSACTION",
    targetKey: "txn:1",
    source: "RECURRING",
    description: "Bill",
    dueDate: "2026-11-10",
    amountMinor: 1000,
    currency: "BRL",
    status: "DUE",
    paidAt: null,
    paidOn: null,
    transactionId: "txn-1",
    creditCardId: null,
    invoiceCycle: null,
    carriedOver: false,
    ...overrides,
  };
}

const zeroSources: MonthlySummaryView["currencies"][number]["bySource"] = [
  { source: "MANUAL", amountMinor: 0 },
  { source: "RECURRING", amountMinor: 0 },
  { source: "CARD", amountMinor: 0 },
  { source: "IMPORTED", amountMinor: 0 },
];

const summary: MonthlySummaryView = {
  month: "2026-11",
  monthStart: "2026-11-01",
  monthEnd: "2026-11-30",
  today: "2026-11-21",
  hasActivity: true,
  currencies: [
    {
      currency: "BRL",
      totalMinor: 115598,
      bySource: [
        { source: "MANUAL", amountMinor: 5000 },
        { source: "RECURRING", amountMinor: 97048 },
        { source: "CARD", amountMinor: 12550 },
        { source: "IMPORTED", amountMinor: 1000 },
      ],
      byCategory: [
        { label: "Housing", amountMinor: 85048 },
        { label: null, amountMinor: 30550 },
      ],
    },
  ],
  dueItems: [
    dueItem({
      targetKey: "txn:sep",
      transactionId: "txn-sep",
      description: "Condo",
      dueDate: "2026-09-10",
      amountMinor: 85048,
      status: "OVERDUE",
      carriedOver: true,
    }),
    dueItem({
      targetType: "CARD_INVOICE",
      targetKey: "card:c1:2026-11",
      transactionId: null,
      creditCardId: "c1",
      invoiceCycle: "2026-11",
      source: "CARD",
      description: "Visa Gold",
      dueDate: "2026-11-20",
      amountMinor: 12550,
      status: "OVERDUE",
    }),
    dueItem({
      targetKey: "txn:net",
      transactionId: "txn-net",
      description: "Internet",
      dueDate: "2026-11-25",
      amountMinor: 12000,
      status: "DUE",
    }),
    dueItem({
      targetKey: "txn:nov",
      description: "Condo November",
      dueDate: "2026-11-10",
      amountMinor: 85048,
      transactionId: "txn-nov",
      status: "PAID",
      paidAt: "2026-11-09T12:00:00.000Z",
      paidOn: "2026-11-08",
    }),
  ],
  dueTotals: [
    {
      currency: "BRL",
      overdueCount: 2,
      overdueMinor: 97598,
      dueCount: 1,
      dueMinor: 12000,
    },
  ],
  overdueLookbackFrom: "2026-08",
};

const emptySummary: MonthlySummaryView = {
  ...summary,
  hasActivity: false,
  currencies: [
    { currency: "BRL", totalMinor: 0, bySource: zeroSources, byCategory: [] },
  ],
  dueItems: [],
  dueTotals: [],
};

beforeEach(() => {
  getMonthlySummary.mockReset();
  setBillPayment.mockReset();
});

describe("DashboardPage", () => {
  it("shows a loading state while the summary is fetched", () => {
    getMonthlySummary.mockReturnValue(new Promise(() => undefined));
    render(<DashboardPage />);

    expect(screen.getByRole("status")).toBeDefined();
  });

  it("renders the month label, totals and per-source subtotals", async () => {
    getMonthlySummary.mockResolvedValue({ ok: true, data: summary });
    render(<DashboardPage />);

    await screen.findByRole("heading", { name: "November 2026" });
    const totals = within(screen.getByRole("region", { name: /total/i }));
    expect(totals.getByText("R$ 1.155,98")).toBeDefined();
    expect(totals.getByText("R$ 50,00")).toBeDefined();
    expect(totals.getByText("R$ 970,48")).toBeDefined();
    expect(totals.getByText("R$ 125,50")).toBeDefined();
    expect(totals.getByText("R$ 10,00")).toBeDefined();
    expect(totals.getByText(/month they are due/i)).toBeDefined();
  });

  it("renders the backend's overdue and still-to-pay totals verbatim", async () => {
    getMonthlySummary.mockResolvedValue({ ok: true, data: summary });
    render(<DashboardPage />);

    const panel = within(
      await screen.findByRole("region", { name: /bills status/i }),
    );
    expect(panel.getByText(/Overdue: 2 · R\$ 975,98/)).toBeDefined();
    expect(panel.getByText(/Still to pay: 1 · R\$ 120,00/)).toBeDefined();
  });

  it("renders the category breakdown with an uncategorized bucket", async () => {
    getMonthlySummary.mockResolvedValue({ ok: true, data: summary });
    render(<DashboardPage />);

    const table = within(
      await screen.findByRole("table", { name: /by category/i }),
    );
    expect(table.getByText("Housing")).toBeDefined();
    expect(table.getByText("Uncategorized")).toBeDefined();
    expect(table.getByText("R$ 305,50")).toBeDefined();
  });

  it("lists due items in order with a text status and the earlier-month marker", async () => {
    getMonthlySummary.mockResolvedValue({ ok: true, data: summary });
    render(<DashboardPage />);

    const table = await screen.findByRole("table", { name: /bills/i });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(
      rows.map((r) => within(r).getAllByRole("cell")[0]?.textContent),
    ).toEqual([
      "CondoFrom an earlier month",
      "Visa Gold",
      "Internet",
      "Condo November",
    ]);
    expect(
      rows.map((r) => within(r).getByTestId("due-status").textContent),
    ).toEqual(["Overdue", "Overdue", "Due", "Paid"]);
    expect(within(rows[0]!).getByText("10/09/2026")).toBeDefined();
    expect(within(rows[1]!).getByText("Card invoice")).toBeDefined();
    expect(within(rows[1]!).getByText("R$ 125,50")).toBeDefined();
  });

  it("shows the due list's own empty state when the month has activity but no bills", async () => {
    getMonthlySummary.mockResolvedValue({
      ok: true,
      data: { ...summary, dueItems: [], dueTotals: [] },
    });
    render(<DashboardPage />);

    expect(await screen.findByText(/no bills this month/i)).toBeDefined();
  });

  it("shows the empty state with a primary action for a month with no activity", async () => {
    getMonthlySummary.mockResolvedValue({ ok: true, data: emptySummary });
    render(<DashboardPage />);

    expect(await screen.findByText(/nothing recorded/i)).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: /add an expense/i })
        .getAttribute("href"),
    ).toBe("/expenses");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("keeps carried-over overdue bills visible next to the empty state", async () => {
    getMonthlySummary.mockResolvedValue({
      ok: true,
      data: {
        ...emptySummary,
        dueItems: [summary.dueItems[0]!],
        dueTotals: [
          {
            currency: "BRL",
            overdueCount: 1,
            overdueMinor: 85048,
            dueCount: 0,
            dueMinor: 0,
          },
        ],
      },
    });
    render(<DashboardPage />);

    expect(await screen.findByText(/nothing recorded/i)).toBeDefined();
    const table = within(screen.getByRole("table", { name: /bills/i }));
    expect(table.getByText("Overdue")).toBeDefined();
    expect(table.getByText("From an earlier month")).toBeDefined();
    expect(screen.getByText(/Overdue: 1 · R\$ 850,48/)).toBeDefined();
  });

  it("shows a generic error with the request id and retries", async () => {
    getMonthlySummary
      .mockResolvedValueOnce({
        ok: false,
        error: new ApiError({
          code: "INTERNAL_ERROR",
          message: "boom: internal detail",
          requestId: "req-dash-1",
        }),
      })
      .mockResolvedValueOnce({ ok: true, data: summary });
    render(<DashboardPage />);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/could not load/i)).toBeDefined();
    expect(within(alert).getByText(/req-dash-1/)).toBeDefined();
    expect(screen.queryByText(/internal detail/)).toBeNull();

    await userEvent.click(
      within(alert).getByRole("button", { name: /try again/i }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "November 2026" }),
      ).toBeDefined(),
    );
    expect(getMonthlySummary).toHaveBeenCalledTimes(2);
  });

  it("offers mark as paid on unpaid items and undo on paid ones, with the paid date", async () => {
    getMonthlySummary.mockResolvedValue({ ok: true, data: summary });
    render(<DashboardPage />);

    const table = within(await screen.findByRole("table", { name: /bills/i }));
    expect(
      table.getByRole("button", { name: "Mark Condo due 10/09/2026 as paid" }),
    ).toBeDefined();
    expect(
      table.getByRole("button", {
        name: "Mark Visa Gold due 20/11/2026 as paid",
      }),
    ).toBeDefined();
    expect(
      table.getByRole("button", {
        name: "Undo payment for Condo November due 10/11/2026",
      }),
    ).toBeDefined();
    expect(table.getByText("on 08/11/2026")).toBeDefined();
  });

  it("marks a card invoice by its parts and refreshes the summary in place", async () => {
    const paidInvoice = {
      ...summary,
      dueItems: summary.dueItems.map((item) =>
        item.targetKey === "card:c1:2026-11"
          ? { ...item, status: "PAID" as const, paidOn: "2026-11-21" }
          : item,
      ),
    };
    getMonthlySummary
      .mockResolvedValueOnce({ ok: true, data: summary })
      .mockResolvedValueOnce({ ok: true, data: paidInvoice });
    setBillPayment.mockResolvedValue({
      ok: true,
      data: {
        targetType: "CARD_INVOICE",
        targetKey: "card:c1:2026-11",
        paid: true,
        paidOn: "2026-11-21",
        recordedAt: "2026-11-21T12:00:00.000Z",
      },
    });
    render(<DashboardPage />);

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Mark Visa Gold due 20/11/2026 as paid",
      }),
    );
    expect(screen.getByLabelText(/payment date/i).getAttribute("max")).toBe(
      "2026-11-21",
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Confirm payment for Visa Gold due 20/11/2026",
      }),
    );

    expect(setBillPayment).toHaveBeenCalledWith({
      targetType: "CARD_INVOICE",
      creditCardId: "c1",
      invoiceCycle: "2026-11",
      paid: true,
    });
    expect(
      await screen.findByRole("button", {
        name: "Undo payment for Visa Gold due 20/11/2026",
      }),
    ).toBeDefined();
    expect(getMonthlySummary).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
