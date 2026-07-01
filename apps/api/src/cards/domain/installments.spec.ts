import { installmentCycles, splitInstallments } from "./installments";

describe("splitInstallments (R5)", () => {
  it("splits evenly when divisible", () => {
    expect(splitInstallments(6000, 3)).toEqual([2000, 2000, 2000]);
  });

  it("adds the residual cents to the first installment", () => {
    // 10000 / 3 = 3333 base, remainder 1 -> first gets +1
    expect(splitInstallments(10000, 3)).toEqual([3334, 3333, 3333]);
  });

  it("returns the full amount for a single installment", () => {
    expect(splitInstallments(9999, 1)).toEqual([9999]);
  });

  it("always sums exactly to the total", () => {
    for (const [total, n] of [
      [10000, 3],
      [10001, 7],
      [999, 4],
      [12345, 6],
    ] as const) {
      const parts = splitInstallments(total, n);
      expect(parts).toHaveLength(n);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("rejects invalid inputs", () => {
    expect(() => splitInstallments(0, 3)).toThrow();
    expect(() => splitInstallments(-100, 3)).toThrow();
    expect(() => splitInstallments(1000, 0)).toThrow();
  });
});

describe("installmentCycles (R5)", () => {
  it("returns n consecutive cycles from the start", () => {
    expect(installmentCycles("2026-03", 3)).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
    ]);
  });

  it("rolls the year", () => {
    expect(installmentCycles("2026-11", 4)).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });

  it("returns a single cycle for n=1", () => {
    expect(installmentCycles("2026-06", 1)).toEqual(["2026-06"]);
  });

  it("rejects invalid inputs", () => {
    expect(() => installmentCycles("2026-13", 2)).toThrow();
    expect(() => installmentCycles("2026-06", 0)).toThrow();
  });
});
