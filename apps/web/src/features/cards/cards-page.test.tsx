import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreditCardView, Paginated } from "@paypilot/shared";
import { ApiError, type ApiResult } from "../../lib/api/api-error";
import { CardsPage } from "./cards-page";

const listCreditCards =
  vi.fn<() => Promise<ApiResult<Paginated<CreditCardView>>>>();

vi.mock("../../lib/api/cards", () => ({
  listCreditCards: (): Promise<ApiResult<Paginated<CreditCardView>>> =>
    listCreditCards(),
}));

function card(overrides: Partial<CreditCardView> = {}): CreditCardView {
  return {
    id: "card-1",
    label: "Nubank",
    closingDay: 28,
    dueDay: 10,
    creditLimitMinor: null,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function pageOf(data: CreditCardView[]): ApiResult<Paginated<CreditCardView>> {
  return {
    ok: true,
    data: { data, meta: { page: 1, pageSize: 100, total: data.length } },
  };
}

beforeEach(() => {
  listCreditCards.mockReset();
});

describe("CardsPage", () => {
  it("shows a loading state while pending", () => {
    listCreditCards.mockReturnValue(new Promise(() => undefined));
    render(<CardsPage />);
    expect(screen.getByRole("status")).toBeDefined();
  });

  it("renders cards with closing and due day", async () => {
    listCreditCards.mockResolvedValue(pageOf([card()]));
    render(<CardsPage />);

    await waitFor(() => expect(screen.getByText("Nubank")).toBeDefined());
    expect(screen.getByText(/Closes on day 28/)).toBeDefined();
    expect(screen.getByText(/due on day 10/)).toBeDefined();
  });

  it("links to the invoice for the picked cycle", async () => {
    listCreditCards.mockResolvedValue(pageOf([card()]));
    render(<CardsPage />);
    await waitFor(() => expect(screen.getByText("Nubank")).toBeDefined());

    const cycleInput = screen.getByLabelText("Invoice cycle");
    expect((cycleInput as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}$/);

    const user = userEvent.setup();
    await user.clear(cycleInput);
    await user.type(cycleInput, "2026-05");

    const link = screen.getByRole("link", { name: "View invoice" });
    expect(link.getAttribute("href")).toBe("/cards/card-1/invoices/2026-05");
  });

  it("shows the empty state when there are no cards", async () => {
    listCreditCards.mockResolvedValue(pageOf([]));
    render(<CardsPage />);
    await waitFor(() =>
      expect(screen.getByText("No credit cards yet")).toBeDefined(),
    );
  });

  it("shows a retryable error state on failure", async () => {
    listCreditCards.mockResolvedValue({
      ok: false,
      error: new ApiError({
        code: "INTERNAL_ERROR",
        message: "boom",
        requestId: "req-cards-1",
      }),
    });
    render(<CardsPage />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("req-cards-1");
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });
});
