import { addDays, windowsFor } from "./reminder-windows";

describe("addDays (UTC string arithmetic)", () => {
  it("adds days within a month", () => {
    expect(addDays("2026-03-07", 3)).toBe("2026-03-10");
    expect(addDays("2026-03-10", 0)).toBe("2026-03-10");
  });

  it("rolls over month and year boundaries", () => {
    expect(addDays("2026-02-27", 3)).toBe("2026-03-02");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("handles leap February", () => {
    expect(addDays("2028-02-27", 3)).toBe("2028-03-01"); // 2028 is a leap year
    expect(addDays("2026-02-26", 3)).toBe("2026-03-01"); // 2026 is not
  });

  it("rejects an invalid calendar date", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(/date/i);
    expect(() => addDays("not-a-date", 1)).toThrow(/date/i);
  });
});

describe("windowsFor (R-windows D-3 and D-0, exact-match-only)", () => {
  it("matches D-3 exactly three days before the due date", () => {
    expect(windowsFor("2026-03-10", "2026-03-07")).toEqual([3]);
  });

  it("matches D-0 on the due date", () => {
    expect(windowsFor("2026-03-10", "2026-03-10")).toEqual([0]);
  });

  it("matches across a month boundary", () => {
    expect(windowsFor("2026-03-02", "2026-02-27")).toEqual([3]);
  });

  it("returns no windows for non-matching days", () => {
    expect(windowsFor("2026-03-10", "2026-03-08")).toEqual([]); // D-2: not a window
    expect(windowsFor("2026-03-10", "2026-03-06")).toEqual([]); // D-4: not a window
  });

  it("never matches past windows (catch-up is exact-match-only)", () => {
    expect(windowsFor("2026-03-10", "2026-03-11")).toEqual([]);
    expect(windowsFor("2026-03-10", "2026-04-01")).toEqual([]);
  });
});
