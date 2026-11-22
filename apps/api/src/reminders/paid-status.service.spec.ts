import { NotFoundException } from "@nestjs/common";
import type { BillPaymentsService } from "../bill-payments/bill-payments.service";
import { PaidStatusService } from "./paid-status.service";

const RECORDED_AT = "2026-03-07T12:00:00.000Z";
const TXN_ID = "8a4f0e1a-1111-4222-8333-444455556666";

const input = {
  targetType: "RECURRING_TRANSACTION" as const,
  transactionId: TXN_ID,
};

function build(setPayment: jest.Mock) {
  const payments = { setPayment } as unknown as BillPaymentsService;
  return new PaidStatusService(payments);
}

describe("PaidStatusService.setPaid (adapter over bill-payments)", () => {
  it("marks paid with today's date and keeps the reminders response shape", async () => {
    const setPayment = jest.fn().mockResolvedValue({
      targetType: "RECURRING_TRANSACTION",
      targetKey: `txn:${TXN_ID}`,
      paid: true,
      paidOn: "2026-03-07",
      recordedAt: RECORDED_AT,
    });

    const view = await build(setPayment).setPaid("u1", input, true);

    // No paidOn is forwarded: the payment date defaults to today.
    expect(setPayment).toHaveBeenCalledWith("u1", { ...input, paid: true });
    expect(view).toEqual({
      targetType: "RECURRING_TRANSACTION",
      targetKey: `txn:${TXN_ID}`,
      paid: true,
      paidAt: RECORDED_AT,
    });
  });

  it("unmarks and reports paidAt null", async () => {
    const setPayment = jest.fn().mockResolvedValue({
      targetType: "RECURRING_TRANSACTION",
      targetKey: `txn:${TXN_ID}`,
      paid: false,
      paidOn: null,
      recordedAt: null,
    });

    const view = await build(setPayment).setPaid("u1", input, false);

    expect(setPayment).toHaveBeenCalledWith("u1", { ...input, paid: false });
    expect(view).toEqual({
      targetType: "RECURRING_TRANSACTION",
      targetKey: `txn:${TXN_ID}`,
      paid: false,
      paidAt: null,
    });
  });

  it("propagates the 404 for an unowned or unknown target", async () => {
    const setPayment = jest.fn().mockRejectedValue(new NotFoundException());

    await expect(
      build(setPayment).setPaid("u1", input, true),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
