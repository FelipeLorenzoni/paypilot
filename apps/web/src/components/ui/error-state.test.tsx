import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorState } from "./error-state";

describe("ErrorState", () => {
  it("renders the message and the requestId", () => {
    render(<ErrorState message="Could not load expenses" requestId="req-42" />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Could not load expenses");
    expect(alert.textContent).toContain("req-42");
  });

  it("fires the retry callback", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorState message="Failed" requestId={null} onRetry={onRetry} />);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("omits the retry button when no callback is given", () => {
    render(<ErrorState message="Failed" requestId={null} />);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
