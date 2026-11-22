import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { SetBillPaymentDto } from "./set-bill-payment.dto";

const TXN_ID = "8a4f0e1a-1111-4222-8333-444455556666";
const CARD_ID = "3b2c1d0e-aaaa-4bbb-8ccc-dddd11112222";

function errorsFor(body: Record<string, unknown>) {
  return validateSync(plainToInstance(SetBillPaymentDto, body));
}

describe("SetBillPaymentDto", () => {
  it("accepts a recurring or card identity, with or without a payment date", () => {
    expect(
      errorsFor({
        targetType: "RECURRING_TRANSACTION",
        transactionId: TXN_ID,
        paid: true,
      }),
    ).toEqual([]);
    expect(
      errorsFor({
        targetType: "CARD_INVOICE",
        creditCardId: CARD_ID,
        invoiceCycle: "2026-10",
        paid: true,
        paidOn: "2026-11-09",
      }),
    ).toEqual([]);
    expect(
      errorsFor({
        targetType: "RECURRING_TRANSACTION",
        transactionId: TXN_ID,
        paid: false,
      }),
    ).toEqual([]);
  });

  it("rejects a malformed or impossible payment date", () => {
    for (const paidOn of [
      "2026-11-9",
      "09/11/2026",
      "2026-02-30",
      "",
      20261109,
    ]) {
      expect(
        errorsFor({
          targetType: "RECURRING_TRANSACTION",
          transactionId: TXN_ID,
          paid: true,
          paidOn,
        }),
      ).not.toEqual([]);
    }
  });

  it("rejects a malformed identity or a missing paid flag", () => {
    expect(
      errorsFor({ targetType: "RECURRING_TRANSACTION", paid: true }),
    ).not.toEqual([]);
    expect(
      errorsFor({
        targetType: "CARD_INVOICE",
        creditCardId: CARD_ID,
        invoiceCycle: "2026-13",
        paid: true,
      }),
    ).not.toEqual([]);
    expect(
      errorsFor({ targetType: "MANUAL", transactionId: TXN_ID, paid: true }),
    ).not.toEqual([]);
    expect(
      errorsFor({ targetType: "RECURRING_TRANSACTION", transactionId: TXN_ID }),
    ).not.toEqual([]);
  });
});
