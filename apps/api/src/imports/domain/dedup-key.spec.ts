import { dedupHash, normalizeDescription } from "./dedup-key";

describe("normalizeDescription", () => {
  it("trims, collapses internal whitespace, and lowercases", () => {
    expect(normalizeDescription("  Cafe   da  Manha ")).toBe("cafe da manha");
    expect(normalizeDescription("UBER\t*TRIP\n SP")).toBe("uber *trip sp");
    expect(normalizeDescription("plain")).toBe("plain");
  });
});

describe("dedupHash (R6)", () => {
  it("is identical for equivalent rows (spacing/casing variants)", () => {
    const a = dedupHash("2026-03-01", 2599, "Uber  *Trip");
    const b = dedupHash("2026-03-01", 2599, "  uber *trip ");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs on a one-field near-miss", () => {
    const base = dedupHash("2026-03-01", 2599, "Uber *Trip");
    expect(dedupHash("2026-03-02", 2599, "Uber *Trip")).not.toBe(base); // date
    expect(dedupHash("2026-03-01", 2600, "Uber *Trip")).not.toBe(base); // amount
    expect(dedupHash("2026-03-01", 2599, "Uber *Trip 2")).not.toBe(base); // description
  });

  it("does not collide across field boundaries", () => {
    // The separator prevents "12|3" vs "1|23"-style ambiguity.
    expect(dedupHash("2026-03-01", 12, "3x")).not.toBe(
      dedupHash("2026-03-01", 1, "23x"),
    );
  });
});
