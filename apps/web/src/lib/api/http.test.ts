import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionStore } from "../session/session-store";
import { request } from "./http";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorEnvelope(
  code: string,
  message: string,
  details?: Array<{ field: string; issue: string }>,
) {
  return {
    error: {
      code,
      message,
      requestId: "req-test-1",
      timestamp: "2026-07-06T00:00:00.000Z",
      ...(details ? { details } : {}),
    },
  };
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  sessionStore.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStore.clear();
});

describe("request", () => {
  it("attaches the bearer token on authenticated requests", async () => {
    sessionStore.set("token-1");
    fetchMock.mockResolvedValue(jsonResponse(200, { hello: "world" }));

    const result = await request<{ hello: string }>("/expenses");

    expect(result).toEqual({ ok: true, data: { hello: "world" } });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer token-1",
    );
  });

  it("does not attach a bearer token when auth is false", async () => {
    sessionStore.set("token-1");
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await request("/auth/login", {
      method: "POST",
      body: { email: "a@b.c", password: "x" },
      auth: false,
    });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("Authorization")).toBeNull();
  });

  it("targets the versioned api prefix on the configured base URL", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await request("/expenses", { query: { page: 2, pageSize: 20 } });
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toBe(
      "http://localhost:3000/api/v1/expenses?page=2&pageSize=20",
    );
  });

  it("parses the canonical envelope including details", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        400,
        errorEnvelope("VALIDATION_ERROR", "validation failed", [
          { field: "email", issue: "must be an email" },
        ]),
      ),
    );

    const result = await request("/auth/register", {
      method: "POST",
      auth: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect(result.error.message).toBe("validation failed");
      expect(result.error.requestId).toBe("req-test-1");
      expect(result.error.details).toEqual([
        { field: "email", issue: "must be an email" },
      ]);
    }
  });

  it("degrades an unparseable failure body to NETWORK_ERROR", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>gateway error</html>", { status: 502 }),
    );

    const result = await request("/expenses");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NETWORK_ERROR");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("maps a fetch rejection to NETWORK_ERROR", async () => {
    fetchMock.mockRejectedValue(new TypeError("failed to fetch"));

    const result = await request("/expenses");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NETWORK_ERROR");
    }
  });

  it("clears the session on UNAUTHORIZED without navigating", async () => {
    sessionStore.set("expired-token");
    const listener = vi.fn();
    sessionStore.subscribe(listener);
    fetchMock.mockResolvedValue(
      jsonResponse(401, errorEnvelope("UNAUTHORIZED", "token expired")),
    );
    const href = window.location.href;

    const result = await request("/expenses");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNAUTHORIZED");
    }
    expect(sessionStore.get()).toBeNull();
    expect(listener).toHaveBeenCalled();
    expect(window.location.href).toBe(href); // the client never navigates
  });

  it("does not clear the session when UNAUTHORIZED comes from a public call", async () => {
    sessionStore.set("valid-token");
    fetchMock.mockResolvedValue(
      jsonResponse(401, errorEnvelope("UNAUTHORIZED", "invalid credentials")),
    );

    await request("/auth/login", { method: "POST", auth: false });

    expect(sessionStore.get()).toBe("valid-token");
  });

  it("sends multipart form data without a JSON content type", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { importRunId: "run-1" }));
    const formData = new FormData();
    formData.append("file", new Blob(["a,b\n"]), "data.csv");

    await request("/imports", { method: "POST", formData });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.body).toBe(formData);
    expect(new Headers(init?.headers).get("Content-Type")).toBeNull();
  });

  it("serializes JSON bodies with the JSON content type", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await request("/reminders/settings", {
      method: "PUT",
      body: { enabled: true },
    });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.body).toBe(JSON.stringify({ enabled: true }));
    expect(new Headers(init?.headers).get("Content-Type")).toBe(
      "application/json",
    );
  });
});
