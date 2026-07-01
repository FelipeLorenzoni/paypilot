import {
  type CardTransactionRow,
  type CreditCardRow,
  toCardTransactionResponse,
  toCreditCardResponse,
} from "./card.mapper";

const cardRow: CreditCardRow = {
  id: "11111111-1111-1111-1111-111111111111",
  userId: "22222222-2222-2222-2222-222222222222",
  label: "Visa",
  closingDay: 10,
  dueDay: 20,
  creditLimitMinor: 500000n,
  isActive: true,
  createdAt: new Date("2026-01-01T12:00:00.000Z"),
  updatedAt: new Date("2026-01-02T12:00:00.000Z"),
};

const txRow: CardTransactionRow = {
  id: "33333333-3333-3333-3333-333333333333",
  amountMinor: 12345n,
  currency: "BRL",
  transactionDate: new Date("2026-03-20T00:00:00.000Z"),
  invoiceCycle: "2026-03",
  installmentSeq: 2,
  installmentTotal: 6,
  description: "TV",
  categoryLabel: "electronics",
};

describe("toCreditCardResponse", () => {
  it("maps a card row (limit as number)", () => {
    const res = toCreditCardResponse(cardRow);
    expect(res.creditLimitMinor).toBe(500000);
    expect(typeof res.creditLimitMinor).toBe("number");
    expect(res).toMatchObject({
      label: "Visa",
      closingDay: 10,
      dueDay: 20,
      isActive: true,
    });
    expect(res.createdAt).toBe("2026-01-01T12:00:00.000Z");
  });

  it("maps a null credit limit", () => {
    expect(
      toCreditCardResponse({ ...cardRow, creditLimitMinor: null })
        .creditLimitMinor,
    ).toBeNull();
  });

  it("throws on an unsafe-integer limit", () => {
    expect(() =>
      toCreditCardResponse({
        ...cardRow,
        creditLimitMinor: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      }),
    ).toThrow();
  });
});

describe("toCardTransactionResponse", () => {
  it("maps a generated CARD row and derives dueDate from transactionDate", () => {
    const res = toCardTransactionResponse(txRow);
    expect(res).toMatchObject({
      amountMinor: 12345,
      currency: "BRL",
      invoiceCycle: "2026-03",
      dueDate: "2026-03-20",
      installmentSeq: 2,
      installmentTotal: 6,
      category: "electronics",
    });
    expect(typeof res.amountMinor).toBe("number");
  });

  it("does not shift the derived dueDate under a non-UTC interpretation", () => {
    const res = toCardTransactionResponse({
      ...txRow,
      transactionDate: new Date("2026-02-28T00:00:00.000Z"),
    });
    expect(res.dueDate).toBe("2026-02-28");
  });
});
