import { normalizeEmail } from "./normalize-email";

describe("normalizeEmail", () => {
  it("trims and lowercases (case-insensitive equivalence)", () => {
    const expected = "user@example.com";
    expect(normalizeEmail("User@Example.com")).toBe(expected);
    expect(normalizeEmail("  user@example.com  ")).toBe(expected);
    expect(normalizeEmail("user@example.com")).toBe(expected);
  });

  it("preserves dots and plus aliases (no provider-specific rules)", () => {
    expect(normalizeEmail("u.s.e.r@example.com")).toBe("u.s.e.r@example.com");
    expect(normalizeEmail("user+tag@example.com")).toBe("user+tag@example.com");
    // dotted and plus variants remain distinct from the plain address
    expect(normalizeEmail("u.s.e.r@example.com")).not.toBe(
      normalizeEmail("user@example.com"),
    );
  });
});
