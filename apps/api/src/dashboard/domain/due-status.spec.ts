import { dueStatus } from "./due-status";

describe("dueStatus (the single status rule)", () => {
  const today = "2026-11-21";

  it("is DUE when unpaid and due today", () => {
    expect(dueStatus("2026-11-21", today, false)).toBe("DUE");
  });

  it("is DUE when unpaid and due later", () => {
    expect(dueStatus("2026-12-10", today, false)).toBe("DUE");
  });

  it("is OVERDUE when unpaid and due yesterday", () => {
    expect(dueStatus("2026-11-20", today, false)).toBe("OVERDUE");
  });

  it("is OVERDUE across a month and year boundary", () => {
    expect(dueStatus("2026-12-31", "2027-01-01", false)).toBe("OVERDUE");
  });

  it("is PAID whenever a marker exists, whatever the due date", () => {
    expect(dueStatus("2026-08-11", today, true)).toBe("PAID");
    expect(dueStatus("2026-11-21", today, true)).toBe("PAID");
    expect(dueStatus("2026-12-10", today, true)).toBe("PAID");
  });

  it("rejects a malformed date", () => {
    expect(() => dueStatus("2026-11-2", today, false)).toThrow(/date/i);
    expect(() => dueStatus("2026-11-20", "today", false)).toThrow(/date/i);
  });
});
