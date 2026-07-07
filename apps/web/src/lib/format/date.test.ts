import { describe, expect, it } from "vitest";
import { formatDate } from "./date";

describe("formatDate", () => {
  it("formats YYYY-MM-DD as DD/MM/YYYY", () => {
    expect(formatDate("2026-03-10")).toBe("10/03/2026");
  });

  it("keeps leading zeros", () => {
    expect(formatDate("2026-01-05")).toBe("05/01/2026");
  });

  it("handles month/day boundaries without Date construction shifts", () => {
    // 2026-01-01 in a UTC-negative zone would render as 31/12/2025 if a Date
    // object were constructed; string slicing must keep the calendar date.
    expect(formatDate("2026-01-01")).toBe("01/01/2026");
    expect(formatDate("2025-12-31")).toBe("31/12/2025");
  });

  it("returns malformed input unchanged", () => {
    expect(formatDate("2026-3-1")).toBe("2026-3-1");
    expect(formatDate("not-a-date")).toBe("not-a-date");
    expect(formatDate("")).toBe("");
  });
});
