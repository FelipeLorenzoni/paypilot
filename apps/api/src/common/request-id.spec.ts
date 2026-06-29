import { resolveRequestId } from "./request-id";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("resolveRequestId", () => {
  it("uses a non-empty incoming x-request-id", () => {
    expect(resolveRequestId("abc-123")).toBe("abc-123");
  });

  it("uses the first value when the header is an array", () => {
    expect(resolveRequestId(["abc-123", "def-456"])).toBe("abc-123");
  });

  it("generates a UUID v4 when the header is absent", () => {
    expect(resolveRequestId(undefined)).toMatch(UUID_V4);
  });

  it("generates a UUID v4 when the header is blank", () => {
    expect(resolveRequestId("   ")).toMatch(UUID_V4);
  });
});
