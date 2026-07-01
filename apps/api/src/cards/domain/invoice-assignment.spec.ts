import { assignCycle, dueDate } from "./invoice-assignment";

describe("assignCycle (R4)", () => {
  it("assigns to the current cycle on or before the closing day (inclusive)", () => {
    expect(assignCycle("2026-03-10", 10)).toBe("2026-03");
    expect(assignCycle("2026-03-01", 10)).toBe("2026-03");
  });

  it("rolls to the next cycle after the closing day", () => {
    expect(assignCycle("2026-03-11", 10)).toBe("2026-04");
  });

  it("rolls the year at December", () => {
    expect(assignCycle("2026-12-15", 10)).toBe("2027-01");
    expect(assignCycle("2026-12-10", 10)).toBe("2026-12");
  });

  it("clamps the closing day in short months", () => {
    // closingDay 31 in February -> effective closing = 28 (2026 non-leap)
    expect(assignCycle("2026-02-28", 31)).toBe("2026-02");
    // any day in Feb is <= clamped closing, so it stays in the month
    expect(assignCycle("2026-02-27", 31)).toBe("2026-02");
  });

  it("rejects a malformed purchase date", () => {
    expect(() => assignCycle("2026-13-01", 10)).toThrow();
    expect(() => assignCycle("2026-02-30", 10)).toThrow();
    expect(() => assignCycle("not-a-date", 10)).toThrow();
  });
});

describe("dueDate (R4)", () => {
  it("keeps the due date in the closing month when dueDay > closingDay", () => {
    expect(dueDate("2026-03", 10, 20)).toBe("2026-03-20");
  });

  it("rolls the due date to the next month when dueDay <= closingDay", () => {
    expect(dueDate("2026-03", 25, 5)).toBe("2026-04-05");
    // year roll
    expect(dueDate("2026-12", 25, 5)).toBe("2027-01-05");
  });

  it("clamps the due day to the target month length", () => {
    // dueDay 31 > closingDay 10 -> due in cycle month February -> clamp to 28
    expect(dueDate("2026-02", 10, 31)).toBe("2026-02-28");
    // dueDay 31 > closingDay 25 -> due in cycle month April (30 days) -> clamp to 30
    expect(dueDate("2026-04", 25, 31)).toBe("2026-04-30");
    // dueDay 5 <= closingDay 31 -> rolls to next month (Feb) -> 2026-02-05
    expect(dueDate("2026-01", 31, 5)).toBe("2026-02-05");
  });

  it("rejects a malformed cycle", () => {
    expect(() => dueDate("2026-13", 10, 20)).toThrow();
  });
});
