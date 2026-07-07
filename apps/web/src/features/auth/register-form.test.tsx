import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthTokenResponse, MeResponse } from "@paypilot/shared";
import { ApiError, type ApiResult } from "../../lib/api/api-error";
import { sessionStore } from "../../lib/session/session-store";
import { RegisterForm } from "./register-form";

const replace = vi.fn();
const push = vi.fn();
const router = { replace, push };

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

const register =
  vi.fn<(credentials: unknown) => Promise<ApiResult<MeResponse>>>();
const login =
  vi.fn<(credentials: unknown) => Promise<ApiResult<AuthTokenResponse>>>();

vi.mock("../../lib/api/auth", () => ({
  register: (credentials: unknown): Promise<ApiResult<MeResponse>> =>
    register(credentials),
  login: (credentials: unknown): Promise<ApiResult<AuthTokenResponse>> =>
    login(credentials),
}));

const me: MeResponse = {
  id: "user-1",
  email: "felipe@example.com",
  createdAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  replace.mockReset();
  register.mockReset();
  login.mockReset();
  sessionStore.clear();
});

afterEach(() => {
  sessionStore.clear();
});

async function fillAndSubmit(
  email = "felipe@example.com",
  password = "long-enough-password",
): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Create account" }));
}

describe("RegisterForm", () => {
  it("blocks submit on Zod validation failure", async () => {
    render(<RegisterForm />);
    await fillAndSubmit("bad-email", "short");

    expect(register).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a valid email address.")).toBeDefined();
    expect(
      screen.getByText("Password must be at least 12 characters."),
    ).toBeDefined();
  });

  it("auto-logs-in and redirects to the dashboard after registration", async () => {
    register.mockResolvedValue({ ok: true, data: me });
    login.mockResolvedValue({ ok: true, data: { accessToken: "jwt-new" } });
    render(<RegisterForm />);
    await fillAndSubmit();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(sessionStore.get()).toBe("jwt-new");
    expect(register).toHaveBeenCalledWith({
      email: "felipe@example.com",
      password: "long-enough-password",
    });
    expect(login).toHaveBeenCalledWith({
      email: "felipe@example.com",
      password: "long-enough-password",
    });
  });

  it("lands on /login with a prompt when the auto-login step fails", async () => {
    register.mockResolvedValue({ ok: true, data: me });
    login.mockResolvedValue({
      ok: false,
      error: new ApiError({
        code: "TOO_MANY_REQUESTS",
        message: "slow down",
        requestId: "req-r-1",
      }),
    });
    render(<RegisterForm />);
    await fillAndSubmit();

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/login?registered=1"),
    );
    expect(sessionStore.get()).toBeNull();
  });

  it("shows an actionable conflict message when the email exists", async () => {
    register.mockResolvedValue({
      ok: false,
      error: new ApiError({
        code: "CONFLICT",
        message: "duplicate",
        requestId: "req-r-2",
      }),
    });
    render(<RegisterForm />);
    await fillAndSubmit();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This email is already registered.");
    expect(alert.textContent).toContain("req-r-2");
    expect(login).not.toHaveBeenCalled();
  });

  it("maps VALIDATION_ERROR details to fields and preserves values", async () => {
    register.mockResolvedValue({
      ok: false,
      error: new ApiError({
        code: "VALIDATION_ERROR",
        message: "validation failed",
        requestId: "req-r-3",
        details: [{ field: "password", issue: "password too weak" }],
      }),
    });
    render(<RegisterForm />);
    await fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByText("password too weak")).toBeDefined(),
    );
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "felipe@example.com",
    );
  });
});
