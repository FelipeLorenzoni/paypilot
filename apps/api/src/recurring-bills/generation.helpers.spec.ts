import { clampDay, isEligible } from "./generation.helpers";

describe("clampDay", () => {
  it("returns the requested day when the month is long enough", () => {
    expect(clampDay(15, "2026-03")).toBe("2026-03-15");
    expect(clampDay(1, "2026-03")).toBe("2026-03-01");
  });

  it("clamps day 31 to the last day of short months", () => {
    expect(clampDay(31, "2026-02")).toBe("2026-02-28"); // non-leap February
    expect(clampDay(31, "2024-02")).toBe("2024-02-29"); // leap February
    expect(clampDay(31, "2026-04")).toBe("2026-04-30"); // 30-day month
    expect(clampDay(31, "2026-01")).toBe("2026-01-31"); // 31-day month
  });

  it("clamps day 30 only where needed", () => {
    expect(clampDay(30, "2026-02")).toBe("2026-02-28");
    expect(clampDay(30, "2024-02")).toBe("2024-02-29");
    expect(clampDay(30, "2026-04")).toBe("2026-04-30");
  });

  it("rejects a malformed period", () => {
    expect(() => clampDay(15, "2026-13")).toThrow();
    expect(() => clampDay(15, "2026-3")).toThrow();
    expect(() => clampDay(15, "not-a-period")).toThrow();
  });
});

describe("isEligible", () => {
  it("is true within the window (boundaries inclusive)", () => {
    expect(isEligible("2026-01-01", "2026-12-31", "2026-03-15")).toBe(true);
    expect(isEligible("2026-03-15", "2026-03-15", "2026-03-15")).toBe(true);
  });

  it("is true with no end date when on/after start", () => {
    expect(isEligible("2026-01-01", null, "2026-03-15")).toBe(true);
    expect(isEligible("2026-03-15", null, "2026-03-15")).toBe(true);
  });

  it("is false before start or after end", () => {
    expect(isEligible("2026-04-01", null, "2026-03-31")).toBe(false);
    expect(isEligible("2026-01-01", "2026-02-28", "2026-03-01")).toBe(false);
  });
});
