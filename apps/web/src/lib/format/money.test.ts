import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

describe("formatMoney", () => {
  it("renders one cent", () => {
    expect(formatMoney(1, "BRL")).toBe("R$ 0,01");
  });

  it("renders whole units", () => {
    expect(formatMoney(100, "BRL")).toBe("R$ 1,00");
  });

  it("renders zero", () => {
    expect(formatMoney(0, "BRL")).toBe("R$ 0,00");
  });

  it("groups thousands with dots", () => {
    expect(formatMoney(123456, "BRL")).toBe("R$ 1.234,56");
  });

  it("groups millions", () => {
    expect(formatMoney(100000000, "BRL")).toBe("R$ 1.000.000,00");
  });

  it("groups amounts above a billion minor units", () => {
    expect(formatMoney(123456789012, "BRL")).toBe("R$ 1.234.567.890,12");
  });

  it("renders negative amounts with a leading minus", () => {
    expect(formatMoney(-123456, "BRL")).toBe("-R$ 1.234,56");
  });

  it("is deterministic regardless of process locale", () => {
    // String-based algorithm: repeated calls yield byte-identical output.
    const first = formatMoney(987654321, "BRL");
    expect(first).toBe("R$ 9.876.543,21");
    expect(formatMoney(987654321, "BRL")).toBe(first);
  });

  it("rejects non-integer amounts", () => {
    expect(() => formatMoney(1.5, "BRL")).toThrow();
    expect(() => formatMoney(Number.NaN, "BRL")).toThrow();
    expect(() => formatMoney(Number.MAX_SAFE_INTEGER + 1, "BRL")).toThrow();
  });
});
