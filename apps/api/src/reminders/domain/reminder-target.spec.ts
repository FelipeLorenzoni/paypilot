import { cardInvoiceTarget, recurringTarget } from "./reminder-target";

const TXN_ID = "8a4f0e1a-1111-4222-8333-444455556666";
const CARD_ID = "3b2c1d0e-aaaa-4bbb-8ccc-dddd11112222";

describe("recurringTarget", () => {
  it("builds the canonical txn identity", () => {
    expect(recurringTarget(TXN_ID)).toEqual({
      targetType: "RECURRING_TRANSACTION",
      targetKey: `txn:${TXN_ID}`,
      transactionId: TXN_ID,
      creditCardId: null,
      invoiceCycle: null,
    });
  });

  it("rejects a non-uuid transaction id", () => {
    expect(() => recurringTarget("not-a-uuid")).toThrow(/transaction/i);
  });
});

describe("cardInvoiceTarget", () => {
  it("builds the canonical card invoice identity", () => {
    expect(cardInvoiceTarget(CARD_ID, "2026-03")).toEqual({
      targetType: "CARD_INVOICE",
      targetKey: `card:${CARD_ID}:2026-03`,
      transactionId: null,
      creditCardId: CARD_ID,
      invoiceCycle: "2026-03",
    });
  });

  it("rejects a non-uuid card id and an invalid cycle", () => {
    expect(() => cardInvoiceTarget("nope", "2026-03")).toThrow(/card/i);
    expect(() => cardInvoiceTarget(CARD_ID, "2026-13")).toThrow(/cycle/i);
    expect(() => cardInvoiceTarget(CARD_ID, "202603")).toThrow(/cycle/i);
  });
});
