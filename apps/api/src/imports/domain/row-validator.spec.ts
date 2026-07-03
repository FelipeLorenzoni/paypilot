import { validateRow } from "./row-validator";

const base = (overrides: Record<string, string> = {}) => ({
  date: "2026-03-01",
  amount: "25,99",
  description: "  Lunch  ",
  ...overrides,
});

describe("validateRow", () => {
  it("accepts a valid row (trims, defaults currency to BRL)", () => {
    const r = validateRow(base({ category: " food " }));
    expect(r).toEqual({
      ok: true,
      candidate: {
        date: "2026-03-01",
        amountMinor: 2599,
        currency: "BRL",
        description: "Lunch",
        category: "food",
      },
    });
  });

  it("maps empty category to null and accepts explicit BRL (any casing)", () => {
    const r1 = validateRow(base());
    expect(r1.ok && r1.candidate.category).toBeNull();
    const r2 = validateRow(base({ currency: "brl" }));
    expect(r2.ok).toBe(true);
  });

  it("rejects missing required fields", () => {
    expect(validateRow(base({ date: " " }))).toEqual({
      ok: false,
      reasonCode: "MISSING_FIELD",
    });
    expect(validateRow(base({ amount: "" }))).toEqual({
      ok: false,
      reasonCode: "MISSING_FIELD",
    });
    expect(validateRow(base({ description: "" }))).toEqual({
      ok: false,
      reasonCode: "MISSING_FIELD",
    });
  });

  it("rejects an invalid calendar date", () => {
    expect(validateRow(base({ date: "2026-02-30" }))).toEqual({
      ok: false,
      reasonCode: "INVALID_DATE",
    });
    expect(validateRow(base({ date: "01/03/2026" }))).toEqual({
      ok: false,
      reasonCode: "INVALID_DATE",
    });
  });

  it("propagates amount reason codes", () => {
    expect(validateRow(base({ amount: "1,2,3" }))).toEqual({
      ok: false,
      reasonCode: "INVALID_AMOUNT_FORMAT",
    });
    expect(validateRow(base({ amount: "-10" }))).toEqual({
      ok: false,
      reasonCode: "NON_POSITIVE_AMOUNT",
    });
  });

  it("rejects unsupported currencies", () => {
    expect(validateRow(base({ currency: "USD" }))).toEqual({
      ok: false,
      reasonCode: "UNSUPPORTED_CURRENCY",
    });
  });

  it("rejects over-long fields", () => {
    expect(validateRow(base({ description: "x".repeat(256) }))).toEqual({
      ok: false,
      reasonCode: "FIELD_TOO_LONG",
    });
    expect(validateRow(base({ category: "y".repeat(101) }))).toEqual({
      ok: false,
      reasonCode: "FIELD_TOO_LONG",
    });
  });
});
