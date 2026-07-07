import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceView } from "@paypilot/shared";
import { ApiError, type ApiResult } from "../../lib/api/api-error";
import { InvoicePage } from "./invoice-page";

const getInvoice =
  vi.fn<(cardId: string, cycle: string) => Promise<ApiResult<InvoiceView>>>();

vi.mock("../../lib/api/cards", () => ({
  getInvoice: (
    cardId: string,
    cycle: string,
  ): Promise<ApiResult<InvoiceView>> => getInvoice(cardId, cycle),
}));

const invoice: InvoiceView = {
  cardId: "card-1",
  cycle: "2026-03",
  dueDate: "2026-04-10",
  totalMinor: 250050,
  transactions: [
    {
      id: "tx-1",
      amountMinor: 200000,
      currency: "BRL",
      invoiceCycle: "2026-03",
      dueDate: "2026-04-10",
      installmentSeq: 1,
      installmentTotal: 3,
      description: "Notebook",
      category: "Electronics",
    },
    {
      id: "tx-2",
      amountMinor: 50050,
      currency: "BRL",
      invoiceCycle: "2026-03",
      dueDate: "2026-04-10",
      installmentSeq: 1,
      installmentTotal: 1,
      description: "Dinner",
      category: null,
    },
  ],
};

beforeEach(() => {
  getInvoice.mockReset();
});

describe("InvoicePage", () => {
  it("renders due date, total and transaction rows", async () => {
    getInvoice.mockResolvedValue({ ok: true, data: invoice });
    render(<InvoicePage cardId="card-1" cycle="2026-03" />);

    await waitFor(() => expect(screen.getByRole("table")).toBeDefined());
    expect(getInvoice).toHaveBeenCalledWith("card-1", "2026-03");
    expect(screen.getByText(/10\/04\/2026/)).toBeDefined();
    expect(screen.getByText(/R\$ 2\.500,50/)).toBeDefined();

    const table = within(screen.getByRole("table"));
    expect(table.getByText("Notebook")).toBeDefined();
    expect(table.getByText("1/3")).toBeDefined();
    expect(table.getByText("R$ 2.000,00")).toBeDefined();
    expect(table.getByText("Dinner")).toBeDefined();
    expect(table.getByText("R$ 500,50")).toBeDefined();
  });

  it("shows a friendly not-found state for an empty cycle", async () => {
    getInvoice.mockResolvedValue({
      ok: false,
      error: new ApiError({
        code: "NOT_FOUND",
        message: "not found",
        requestId: "req-inv-1",
      }),
    });
    render(<InvoicePage cardId="card-1" cycle="2030-01" />);

    await waitFor(() =>
      expect(screen.getByText("No invoice for this cycle")).toBeDefined(),
    );
    // Friendly state, not the generic error surface.
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("shows a retryable error state for other failures", async () => {
    getInvoice.mockResolvedValue({
      ok: false,
      error: new ApiError({
        code: "NETWORK_ERROR",
        message: "offline",
        requestId: null,
      }),
    });
    render(<InvoicePage cardId="card-1" cycle="2026-03" />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });
});
