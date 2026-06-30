import {
  type TransactionRow,
  toAmountBigInt,
  toAmountNumber,
  toDateOnly,
  toDateString,
  toExpenseResponse,
} from "./expense.mapper";

describe("expense.mapper", () => {
  describe("amount bigint <-> number", () => {
    it("round-trips a safe integer", () => {
      expect(toAmountNumber(1000n)).toBe(1000);
      expect(toAmountBigInt(1000)).toBe(1000n);
    });

    it("rejects a bigint above the safe range", () => {
      expect(() =>
        toAmountNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n),
      ).toThrow();
    });

    it("rejects a non-safe-integer number", () => {
      expect(() => toAmountBigInt(1.5)).toThrow();
      expect(() => toAmountBigInt(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    });
  });

  describe("date-only mapping (no timezone shift)", () => {
    it("maps YYYY-MM-DD to UTC midnight and back unchanged", () => {
      expect(toDateOnly("2026-03-01").toISOString()).toBe(
        "2026-03-01T00:00:00.000Z",
      );
      expect(toDateString(new Date("2026-03-01T00:00:00.000Z"))).toBe(
        "2026-03-01",
      );
    });
  });

  describe("toExpenseResponse", () => {
    it("maps ledger field names to the API shape with amountMinor as a number", () => {
      const createdAt = new Date("2026-01-02T03:04:05.000Z");
      const row: TransactionRow = {
        id: "id-1",
        userId: "user-1",
        type: "EXPENSE",
        source: "MANUAL",
        amountMinor: 2599n,
        currency: "BRL",
        transactionDate: new Date("2026-03-01T00:00:00.000Z"),
        description: "Lunch",
        categoryLabel: "food",
        createdAt,
        updatedAt: createdAt,
      };
      expect(toExpenseResponse(row)).toEqual({
        id: "id-1",
        amountMinor: 2599,
        currency: "BRL",
        expenseDate: "2026-03-01",
        description: "Lunch",
        category: "food",
        type: "EXPENSE",
        source: "MANUAL",
        createdAt: "2026-01-02T03:04:05.000Z",
        updatedAt: "2026-01-02T03:04:05.000Z",
      });
      expect(typeof toExpenseResponse(row).amountMinor).toBe("number");
    });
  });
});
