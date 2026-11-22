import { describe, expect, it } from "vitest";
import { formatMonth } from "./month";

describe("formatMonth", () => {
  it("formats YYYY-MM as a month name and year", () => {
    expect(formatMonth("2026-07")).toBe("July 2026");
    expect(formatMonth("2026-11")).toBe("November 2026");
  });

  it("covers the first and last months", () => {
    expect(formatMonth("2027-01")).toBe("January 2027");
    expect(formatMonth("2026-12")).toBe("December 2026");
  });

  it("returns malformed input unchanged", () => {
    expect(formatMonth("2026-13")).toBe("2026-13");
    expect(formatMonth("2026-7")).toBe("2026-7");
    expect(formatMonth("")).toBe("");
  });
});
