import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field } from "./field";

describe("Field", () => {
  it("associates the label with the input", () => {
    render(<Field label="Email" name="email" />);
    expect(screen.getByLabelText("Email")).toBeDefined();
  });

  it("associates the error message via aria-describedby", () => {
    render(<Field label="Email" name="email" error="Invalid email" />);
    const input = screen.getByLabelText("Email");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const message = document.getElementById(describedBy as string);
    expect(message?.textContent).toBe("Invalid email");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("renders no error wiring when there is no error", () => {
    render(<Field label="Email" name="email" />);
    const input = screen.getByLabelText("Email");
    expect(input.getAttribute("aria-describedby")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });
});
