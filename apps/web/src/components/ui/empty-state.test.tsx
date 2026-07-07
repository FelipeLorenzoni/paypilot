import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("renders title and guidance", () => {
    render(
      <EmptyState
        title="No expenses yet"
        description="Add your first expense to see it here."
      />,
    );
    expect(screen.getByText("No expenses yet")).toBeDefined();
    expect(
      screen.getByText("Add your first expense to see it here."),
    ).toBeDefined();
  });

  it("renders an optional action", () => {
    render(
      <EmptyState
        title="No imports yet"
        action={<a href="/imports">Upload a CSV</a>}
      />,
    );
    expect(screen.getByRole("link", { name: "Upload a CSV" })).toBeDefined();
  });
});
