import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BillPaymentView, SetBillPaymentRequest } from "@paypilot/shared";
import { ApiError, type ApiResult } from "../../lib/api/api-error";
import { PaymentAction } from "./payment-action";

const setBillPayment =
  vi.fn<(body: SetBillPaymentRequest) => Promise<ApiResult<BillPaymentView>>>();

vi.mock("../../lib/api/bill-payments", () => ({
  setBillPayment: (
    body: SetBillPaymentRequest,
  ): Promise<ApiResult<BillPaymentView>> => setBillPayment(body),
}));

const TARGET = {
  targetType: "RECURRING_TRANSACTION" as const,
  transactionId: "txn-1",
};

const paidView: BillPaymentView = {
  targetType: "RECURRING_TRANSACTION",
  targetKey: "txn:txn-1",
  paid: true,
  paidOn: "2026-11-21",
  recordedAt: "2026-11-21T12:00:00.000Z",
};

function renderAction(
  props: Partial<Parameters<typeof PaymentAction>[0]> = {},
) {
  const onChanged = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
  render(
    <PaymentAction
      target={TARGET}
      paid={false}
      label="Condo"
      maxDate="2026-11-21"
      onChanged={onChanged}
      {...props}
    />,
  );
  return { onChanged };
}

beforeEach(() => {
  setBillPayment.mockReset();
});

describe("PaymentAction — mark as paid", () => {
  it("marks with today's date when no date is chosen, then refreshes", async () => {
    setBillPayment.mockResolvedValue({ ok: true, data: paidView });
    const { onChanged } = renderAction();

    await userEvent.click(
      screen.getByRole("button", { name: "Mark Condo as paid" }),
    );
    const date = screen.getByLabelText(/payment date/i);
    expect(date.getAttribute("max")).toBe("2026-11-21");
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm payment for Condo" }),
    );

    expect(setBillPayment).toHaveBeenCalledWith({ ...TARGET, paid: true });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("sends a chosen earlier payment date", async () => {
    setBillPayment.mockResolvedValue({ ok: true, data: paidView });
    renderAction();

    await userEvent.click(
      screen.getByRole("button", { name: "Mark Condo as paid" }),
    );
    fireEvent.change(screen.getByLabelText(/payment date/i), {
      target: { value: "2026-11-09" },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm payment for Condo" }),
    );

    expect(setBillPayment).toHaveBeenCalledWith({
      ...TARGET,
      paid: true,
      paidOn: "2026-11-09",
    });
  });

  it("cancels without calling the backend", async () => {
    renderAction();

    await userEvent.click(
      screen.getByRole("button", { name: "Mark Condo as paid" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(setBillPayment).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/payment date/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Mark Condo as paid" }),
    ).toBeDefined();
  });

  it("disables the control and shows progress while saving", async () => {
    let resolve!: (value: ApiResult<BillPaymentView>) => void;
    setBillPayment.mockReturnValue(new Promise((r) => (resolve = r)));
    renderAction();

    await userEvent.click(
      screen.getByRole("button", { name: "Mark Condo as paid" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm payment for Condo" }),
    );

    const saving = screen.getByRole("button", {
      name: "Confirm payment for Condo",
    });
    expect(saving.hasAttribute("disabled")).toBe(true);
    expect(saving.textContent).toBe("Saving…");
    await act(async () => resolve({ ok: true, data: paidView }));
  });

  it("keeps the state and shows the request id when saving fails", async () => {
    setBillPayment.mockResolvedValue({
      ok: false,
      error: new ApiError({
        code: "VALIDATION_ERROR",
        message: "paidOn must not be in the future",
        requestId: "req-pay-1",
      }),
    });
    const { onChanged } = renderAction();

    await userEvent.click(
      screen.getByRole("button", { name: "Mark Condo as paid" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm payment for Condo" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not save/i);
    expect(alert.textContent).toMatch(/req-pay-1/);
    expect(alert.textContent).not.toMatch(/future/);
    expect(onChanged).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Confirm payment for Condo" }),
    ).toBeDefined();
  });
});

describe("PaymentAction — undo", () => {
  it("unmarks a paid item in one action, then refreshes", async () => {
    setBillPayment.mockResolvedValue({
      ok: true,
      data: { ...paidView, paid: false, paidOn: null, recordedAt: null },
    });
    const { onChanged } = renderAction({ paid: true });

    expect(screen.queryByRole("button", { name: /mark/i })).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Undo payment for Condo" }),
    );

    expect(setBillPayment).toHaveBeenCalledWith({ ...TARGET, paid: false });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("is reachable from the keyboard", async () => {
    setBillPayment.mockResolvedValue({ ok: true, data: paidView });
    renderAction({ paid: true });

    await userEvent.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Undo payment for Condo" }),
    );
    await userEvent.keyboard("{Enter}");
    expect(setBillPayment).toHaveBeenCalledTimes(1);
  });
});
