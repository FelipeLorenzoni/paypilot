import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthTokenResponse } from "@paypilot/shared";
import { ApiError, type ApiResult } from "../../lib/api/api-error";
import { sessionStore } from "../../lib/session/session-store";
import { LoginForm } from "./login-form";

const replace = vi.fn();
const push = vi.fn();
const router = { replace, push };

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

const login =
  vi.fn<(credentials: unknown) => Promise<ApiResult<AuthTokenResponse>>>();

vi.mock("../../lib/api/auth", () => ({
  login: (credentials: unknown): Promise<ApiResult<AuthTokenResponse>> =>
    login(credentials),
}));

beforeEach(() => {
  replace.mockReset();
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
  await user.click(screen.getByRole("button", { name: "Log in" }));
}

describe("LoginForm", () => {
  it("blocks submit on invalid email with a Zod message", async () => {
    render(<LoginForm />);
    await fillAndSubmit("not-an-email");

    expect(login).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(screen.getByText("Enter a valid email address.")).toBeDefined();
  });

  it("blocks submit on a too-short password", async () => {
    render(<LoginForm />);
    await fillAndSubmit("felipe@example.com", "short");

    expect(login).not.toHaveBeenCalled();
    expect(
      screen.getByText("Password must be at least 12 characters."),
    ).toBeDefined();
  });

  it("stores the token and redirects to the dashboard on success", async () => {
    login.mockResolvedValue({ ok: true, data: { accessToken: "jwt-1" } });
    render(<LoginForm />);
    await fillAndSubmit();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(sessionStore.get()).toBe("jwt-1");
    expect(login).toHaveBeenCalledWith({
      email: "felipe@example.com",
      password: "long-enough-password",
    });
  });

  it("shows a non-enumerating message with requestId on bad credentials", async () => {
    login.mockResolvedValue({
      ok: false,
      error: new ApiError({
        code: "UNAUTHORIZED",
        message: "invalid credentials",
        requestId: "req-login-1",
      }),
    });
    render(<LoginForm />);
    await fillAndSubmit();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Invalid email or password.");
    expect(alert.textContent).toContain("req-login-1");
    expect(replace).not.toHaveBeenCalled();
  });

  it("maps VALIDATION_ERROR details to the matching fields", async () => {
    login.mockResolvedValue({
      ok: false,
      error: new ApiError({
        code: "VALIDATION_ERROR",
        message: "validation failed",
        requestId: "req-login-2",
        details: [{ field: "email", issue: "email must be an email" }],
      }),
    });
    render(<LoginForm />);
    await fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByText("email must be an email")).toBeDefined(),
    );
  });

  it("preserves form values after a failure", async () => {
    login.mockResolvedValue({
      ok: false,
      error: new ApiError({
        code: "UNAUTHORIZED",
        message: "invalid credentials",
        requestId: "req-login-3",
      }),
    });
    render(<LoginForm />);
    await fillAndSubmit();

    await screen.findByRole("alert");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "felipe@example.com",
    );
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(
      "long-enough-password",
    );
  });
});
