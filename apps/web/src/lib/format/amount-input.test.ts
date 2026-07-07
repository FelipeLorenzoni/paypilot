import { describe, expect, it } from "vitest";
import { parseAmountInput } from "./amount-input";

describe("parseAmountInput", () => {
  it("parses pt-BR grouped input with comma decimals", () => {
    expect(parseAmountInput("1.234,56")).toBe(123456);
  });

  it("parses plain dot-decimal input", () => {
    expect(parseAmountInput("1234.56")).toBe(123456);
  });

  it("parses comma-decimal input without grouping", () => {
    expect(parseAmountInput("1234,56")).toBe(123456);
  });

  it("parses whole-unit input", () => {
    expect(parseAmountInput("1234")).toBe(123400);
  });

  it("pads a single decimal digit", () => {
    expect(parseAmountInput("12,5")).toBe(1250);
    expect(parseAmountInput("12.5")).toBe(1250);
  });

  it("parses multi-group pt-BR input", () => {
    expect(parseAmountInput("1.234.567,89")).toBe(123456789);
  });

  it("reads dot-separated triplets as pt-BR grouping, not decimals", () => {
    expect(parseAmountInput("12.345")).toBe(1234500);
    expect(parseAmountInput("1.234")).toBe(123400);
  });

  it("trims surrounding whitespace", () => {
    expect(parseAmountInput("  42,00 ")).toBe(4200);
  });

  it("returns null for empty input", () => {
    expect(parseAmountInput("")).toBeNull();
    expect(parseAmountInput("   ")).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(parseAmountInput("abc")).toBeNull();
    expect(parseAmountInput("12,34,56")).toBeNull();
    expect(parseAmountInput("1.23.45")).toBeNull();
    expect(parseAmountInput("12.34.5")).toBeNull();
  });

  it("returns null for more than two decimal digits", () => {
    expect(parseAmountInput("1,234")).toBeNull();
    expect(parseAmountInput("1.2345")).toBeNull();
  });

  it("returns null for negative input", () => {
    expect(parseAmountInput("-10,00")).toBeNull();
  });

  it("returns null when the result would overflow safe integers", () => {
    expect(parseAmountInput("92233720368547758,08")).toBeNull();
  });
});
