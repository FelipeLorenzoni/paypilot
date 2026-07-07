import { describe, expect, it } from "vitest";
import { ApiError } from "./api-error";
import { mapApiErrorToForm } from "./error-mapping";

describe("mapApiErrorToForm", () => {
  it("maps VALIDATION_ERROR details onto known fields", () => {
    const error = new ApiError({
      code: "VALIDATION_ERROR",
      message: "validation failed",
      requestId: "req-1",
      details: [
        { field: "email", issue: "must be an email" },
        { field: "password", issue: "too short" },
      ],
    });

    const mapped = mapApiErrorToForm(error, ["email", "password"]);

    expect(mapped.fieldErrors).toEqual({
      email: "must be an email",
      password: "too short",
    });
    expect(mapped.formMessage).toBeNull();
    expect(mapped.requestId).toBe("req-1");
  });

  it("falls back to a form-level message for unmatched fields", () => {
    const error = new ApiError({
      code: "VALIDATION_ERROR",
      message: "validation failed",
      requestId: "req-2",
      details: [{ field: "phoneE164", issue: "must be E.164" }],
    });

    const mapped = mapApiErrorToForm(error, ["email"]);

    expect(mapped.fieldErrors).toEqual({});
    expect(mapped.formMessage).toContain("phoneE164");
    expect(mapped.requestId).toBe("req-2");
  });

  it("uses caller-provided messages for known codes", () => {
    const error = new ApiError({
      code: "CONFLICT",
      message: "raw backend text",
      requestId: "req-3",
    });

    const mapped = mapApiErrorToForm(error, [], {
      CONFLICT: "This email is already registered.",
    });

    expect(mapped.formMessage).toBe("This email is already registered.");
    expect(mapped.formMessage).not.toContain("raw backend text");
  });

  it("never surfaces the raw backend message for known codes", () => {
    const error = new ApiError({
      code: "UNAUTHORIZED",
      message: "user felipe@example.com not found in table users",
      requestId: "req-4",
    });

    const mapped = mapApiErrorToForm(error, []);

    expect(mapped.formMessage).toBeTruthy();
    expect(mapped.formMessage).not.toContain("felipe@example.com");
  });
});
