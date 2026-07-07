import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult } from "../../lib/api/api-error";
import type { MeResponse } from "@paypilot/shared";
import { sessionStore } from "../../lib/session/session-store";
import { AuthProvider } from "../../lib/session/auth-context";
import { AppShell } from "./app-shell";

const replace = vi.fn();
const push = vi.fn();
const router = { replace, push }; // stable, like the real Next router

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/expenses",
}));

const me: MeResponse = {
  id: "user-1",
  email: "felipe@example.com",
  createdAt: "2026-01-01T00:00:00.000Z",
};

vi.mock("../../lib/api/auth", () => ({
  getMe: (): Promise<ApiResult<MeResponse>> =>
    Promise.resolve({ ok: true, data: me }),
}));

function renderShell(): void {
  render(
    <AuthProvider>
      <AppShell>
        <p>page body</p>
      </AppShell>
    </AuthProvider>,
  );
}

beforeEach(() => {
  sessionStore.set("token-1");
  replace.mockReset();
});

describe("AppShell", () => {
  it("exposes nav and main landmarks with all six areas", async () => {
    renderShell();
    await waitFor(() => expect(screen.getByRole("main")).toBeDefined());

    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(nav).toBeDefined();
    for (const label of [
      "Dashboard",
      "Expenses",
      "Recurring bills",
      "Cards & invoices",
      "CSV imports",
      "Reminders/settings",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeDefined();
    }
    expect(screen.getByText("page body")).toBeDefined();
  });

  it("marks the active area from the pathname", async () => {
    renderShell();
    await waitFor(() => expect(screen.getByRole("main")).toBeDefined());

    expect(
      screen
        .getByRole("link", { name: "Expenses" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen
        .getByRole("link", { name: "Dashboard" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("shows the current user's email in the header", async () => {
    renderShell();
    await waitFor(() =>
      expect(screen.getByText("felipe@example.com")).toBeDefined(),
    );
  });

  it("logout clears the session and redirects to /login", async () => {
    const user = userEvent.setup();
    renderShell();
    await waitFor(() => expect(screen.getByRole("main")).toBeDefined());

    await user.click(screen.getByRole("button", { name: "Log out" }));

    expect(sessionStore.get()).toBeNull();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });
});
