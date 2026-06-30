import {
  type RecurringBillRow,
  toRecurringBillResponse,
} from "./recurring-bill.mapper";

const baseRow: RecurringBillRow = {
  id: "11111111-1111-1111-1111-111111111111",
  userId: "22222222-2222-2222-2222-222222222222",
  amountMinor: 12345n,
  currency: "BRL",
  dayOfMonth: 10,
  description: "Rent",
  categoryLabel: "Housing",
  startDate: new Date("2026-01-01T00:00:00.000Z"),
  endDate: new Date("2026-12-31T00:00:00.000Z"),
  isActive: true,
  createdAt: new Date("2026-01-01T12:00:00.000Z"),
  updatedAt: new Date("2026-01-02T12:00:00.000Z"),
};

describe("toRecurringBillResponse", () => {
  it("maps a row to the API shape (amount as number, dates as YYYY-MM-DD)", () => {
    const res = toRecurringBillResponse(baseRow);
    expect(res.amountMinor).toBe(12345);
    expect(typeof res.amountMinor).toBe("number");
    expect(res.startDate).toBe("2026-01-01");
    expect(res.endDate).toBe("2026-12-31");
    expect(res.category).toBe("Housing");
    expect(res.dayOfMonth).toBe(10);
    expect(res.isActive).toBe(true);
    expect(res.createdAt).toBe("2026-01-01T12:00:00.000Z");
  });

  it("maps null end date and null category", () => {
    const res = toRecurringBillResponse({
      ...baseRow,
      endDate: null,
      categoryLabel: null,
    });
    expect(res.endDate).toBeNull();
    expect(res.category).toBeNull();
  });

  it("throws on an unsafe-integer amount", () => {
    expect(() =>
      toRecurringBillResponse({
        ...baseRow,
        amountMinor: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      }),
    ).toThrow();
  });

  it("does not shift the date in a non-UTC interpretation", () => {
    const res = toRecurringBillResponse({
      ...baseRow,
      startDate: new Date("2026-03-01T00:00:00.000Z"),
    });
    expect(res.startDate).toBe("2026-03-01");
  });
});
