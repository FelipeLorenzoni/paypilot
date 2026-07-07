import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormError } from "./form-error";

describe("FormError", () => {
  it("announces the message via role=alert", () => {
    render(<FormError message="Invalid credentials" />);
    expect(screen.getByRole("alert").textContent).toContain(
      "Invalid credentials",
    );
  });

  it("shows the requestId when provided", () => {
    render(<FormError message="Something failed" requestId="req-123" />);
    expect(screen.getByRole("alert").textContent).toContain("req-123");
  });

  it("renders nothing without a message", () => {
    render(<FormError message={null} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
