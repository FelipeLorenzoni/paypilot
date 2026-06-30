import { NotFoundException } from "@nestjs/common";
import { assertOwnership } from "./ownership";

describe("assertOwnership", () => {
  it("passes when the owner matches the current user", () => {
    expect(() => assertOwnership("user-1", "user-1")).not.toThrow();
  });

  it("throws a 404-like NotFoundException for a non-owner (no disclosure)", () => {
    expect(() => assertOwnership("user-1", "user-2")).toThrow(
      NotFoundException,
    );
  });
});
