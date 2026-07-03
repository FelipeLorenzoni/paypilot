import { parseAmount } from "./amount-parser";

const ok = (raw: string) => {
  const r = parseAmount(raw);
  if (!r.ok) {
    throw new Error(`expected ok for ${raw}, got ${r.reason}`);
  }
  return r.amountMinor;
};
const fail = (raw: string) => {
  const r = parseAmount(raw);
  if (r.ok) {
    throw new Error(`expected failure for ${raw}`);
  }
  return r.reason;
};

describe("parseAmount", () => {
  it("parses dot-decimal forms", () => {
    expect(ok("1234.56")).toBe(123456);
    expect(ok("1.23")).toBe(123);
    expect(ok("0.5")).toBe(50);
    expect(ok("10")).toBe(1000);
  });

  it("parses Brazilian forms", () => {
    expect(ok("1.234,56")).toBe(123456);
    expect(ok("1234,56")).toBe(123456);
    expect(ok("12.345.678,90")).toBe(1234567890);
    expect(ok("1,5")).toBe(150);
    // deterministic resolution: "1.234" is the BR thousands form
    expect(ok("1.234")).toBe(123400);
  });

  it("tolerates a currency symbol and whitespace", () => {
    expect(ok(" R$ 1.234,56 ")).toBe(123456);
    expect(ok("r$10.50")).toBe(1050);
  });

  it("rejects unparseable formats", () => {
    expect(fail("1,2,3")).toBe("INVALID_AMOUNT_FORMAT");
    expect(fail("12.3456")).toBe("INVALID_AMOUNT_FORMAT"); // not a thousands group
    expect(fail("abc")).toBe("INVALID_AMOUNT_FORMAT");
    expect(fail("1.234,567")).toBe("INVALID_AMOUNT_FORMAT"); // 3 decimals
    expect(fail("")).toBe("INVALID_AMOUNT_FORMAT");
  });

  it("rejects non-positive amounts (expenses-only MVP)", () => {
    expect(fail("0")).toBe("NON_POSITIVE_AMOUNT");
    expect(fail("0,00")).toBe("NON_POSITIVE_AMOUNT");
    expect(fail("-5")).toBe("NON_POSITIVE_AMOUNT");
    expect(fail("-1.234,56")).toBe("NON_POSITIVE_AMOUNT");
  });
});
