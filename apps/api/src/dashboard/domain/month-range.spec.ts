import { lookbackFrom, monthOf, monthRange, shiftMonth } from "./month-range";

describe("monthOf (UTC calendar month of an instant)", () => {
  it("returns the UTC month, not the local one", () => {
    expect(monthOf(new Date("2026-07-15T12:00:00Z"))).toBe("2026-07");
    // 23:30 at UTC-3 on Jul 31 is already Aug 1 in UTC.
    expect(monthOf(new Date("2026-08-01T02:30:00Z"))).toBe("2026-08");
    expect(monthOf(new Date("2026-12-31T23:59:59.999Z"))).toBe("2026-12");
  });
});

describe("monthRange (inclusive date-only boundaries)", () => {
  it("uses the real length of a 31-day month", () => {
    expect(monthRange("2026-07")).toEqual({
      start: "2026-07-01",
      end: "2026-07-31",
    });
  });

  it("handles a 30-day month", () => {
    expect(monthRange("2026-11")).toEqual({
      start: "2026-11-01",
      end: "2026-11-30",
    });
  });

  it("handles non-leap and leap February", () => {
    expect(monthRange("2026-02").end).toBe("2026-02-28");
    expect(monthRange("2028-02").end).toBe("2028-02-29");
  });

  it("handles December", () => {
    expect(monthRange("2026-12")).toEqual({
      start: "2026-12-01",
      end: "2026-12-31",
    });
  });

  it("rejects a malformed month", () => {
    for (const bad of [
      "2026-13",
      "2026-00",
      "2026-7",
      "26-07",
      "",
      "2026-07-01",
    ]) {
      expect(() => monthRange(bad)).toThrow(/month/i);
    }
  });
});

describe("shiftMonth", () => {
  it("moves forward and backward across the year boundary", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
    expect(shiftMonth("2026-07", 0)).toBe("2026-07");
  });

  it("rejects a malformed month", () => {
    expect(() => shiftMonth("2026-13", 1)).toThrow(/month/i);
  });
});

describe("lookbackFrom (first month of the overdue look-back window)", () => {
  it("is three calendar months before the month", () => {
    expect(lookbackFrom("2026-11")).toBe("2026-08");
  });

  it("crosses back over January into the previous year", () => {
    expect(lookbackFrom("2027-01")).toBe("2026-10");
    expect(lookbackFrom("2026-03")).toBe("2025-12");
  });
});
