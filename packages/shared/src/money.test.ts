import { createMoney } from "./money";

describe("createMoney", () => {
  it("creates money from a safe-integer amount and ISO-4217 currency", () => {
    const money = createMoney(1000, "BRL");
    expect(money).toEqual({ amountMinor: 1000, currency: "BRL" });
  });

  it("rejects a non-integer amount", () => {
    expect(() => createMoney(10.5, "BRL")).toThrow();
  });

  it("rejects an unsafe-integer amount", () => {
    expect(() => createMoney(Number.MAX_SAFE_INTEGER + 1, "BRL")).toThrow();
  });

  it("rejects an invalid currency code", () => {
    expect(() => createMoney(1000, "reais")).toThrow();
  });
});
