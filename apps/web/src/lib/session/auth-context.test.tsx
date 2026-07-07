import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type ApiResult } from "../api/api-error";
import type { MeResponse } from "@paypilot/shared";
import { sessionStore } from "./session-store";
import { AuthProvider } from "./auth-context";

const replace = vi.fn();
const push = vi.fn();
// Stable object like the real Next router — a fresh object per render would
// re-trigger every router-dependent effect and loop forever.
const router = { replace, push };

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/dashboard",
}));

const getMe = vi.fn<() => Promise<ApiResult<MeResponse>>>();

vi.mock("../api/auth", () => ({
  getMe: (): Promise<ApiResult<MeResponse>> => getMe(),
}));

const user: MeResponse = {
  id: "user-1",
  email: "felipe@example.com",
  createdAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  replace.mockReset();
  push.mockReset();
  getMe.mockReset();
  sessionStore.clear();
  replace.mockClear(); // clear() above notifies; drop that redirect call
});

afterEach(() => {
  sessionStore.clear();
});

describe("AuthProvider", () => {
  it("redirects unauthenticated visitors to /login without protected content", async () => {
    render(
      <AuthProvider>
        <p>protected content</p>
      </AuthProvider>,
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("protected content")).toBeNull();
    expect(getMe).not.toHaveBeenCalled();
  });

  it("shows a loading state while getMe is pending, never protected content", async () => {
    sessionStore.set("token-1");
    getMe.mockReturnValue(new Promise(() => undefined)); // never resolves

    render(
      <AuthProvider>
        <p>protected content</p>
      </AuthProvider>,
    );

    expect(screen.getByRole("status")).toBeDefined();
    expect(screen.queryByText("protected content")).toBeNull();
  });

  it("renders children once the user resolves", async () => {
    sessionStore.set("token-1");
    getMe.mockResolvedValue({ ok: true, data: user });

    render(
      <AuthProvider>
        <p>protected content</p>
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText("protected content")).toBeDefined(),
    );
  });

  it("redirects to /login when the session is cleared mid-session", async () => {
    sessionStore.set("token-1");
    getMe.mockResolvedValue({ ok: true, data: user });

    render(
      <AuthProvider>
        <p>protected content</p>
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText("protected content")).toBeDefined(),
    );

    // The api client clears the session when it detects UNAUTHORIZED.
    sessionStore.clear();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("shows a retryable error when getMe fails for non-auth reasons", async () => {
    sessionStore.set("token-1");
    getMe.mockResolvedValue({
      ok: false,
      error: new ApiError({ code: "NETWORK_ERROR", message: "offline" }),
    });

    render(
      <AuthProvider>
        <p>protected content</p>
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    expect(screen.queryByText("protected content")).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });
});
