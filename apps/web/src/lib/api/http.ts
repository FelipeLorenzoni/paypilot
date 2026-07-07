import { ErrorCode, type ErrorResponse } from "@paypilot/shared";
import { env } from "../../env";
import { sessionStore } from "../session/session-store";
import { ApiError, type ApiResult } from "./api-error";

// The ONLY module that touches fetch and the base URL. It never navigates:
// on UNAUTHORIZED it clears the session and returns the typed error — the
// redirect to /login is owned by AuthProvider via the session subscription.

const API_PREFIX = "/api/v1";

export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Attach the stored bearer token (default true; false for public auth calls). */
  auth?: boolean;
  formData?: FormData;
  query?: QueryParams;
}

function buildUrl(path: string, query?: QueryParams): string {
  const base = env.NEXT_PUBLIC_API_BASE_URL.replace(/\/$/, "");
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return `${base}${API_PREFIX}${path}${qs ? `?${qs}` : ""}`;
}

async function parseErrorBody(response: Response): Promise<ApiError> {
  try {
    const parsed = (await response.json()) as ErrorResponse;
    const raw = parsed.error;
    if (typeof raw?.code !== "string" || typeof raw.message !== "string") {
      return ApiError.network();
    }
    return new ApiError({
      code: raw.code,
      message: raw.message,
      requestId: typeof raw.requestId === "string" ? raw.requestId : null,
      details: raw.details,
    });
  } catch {
    // Unparseable failure body (proxy/html/timeouts) → retryable network-level failure.
    return ApiError.network();
  }
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  const { method = "GET", body, auth = true, formData, query } = options;

  const headers = new Headers();
  if (auth) {
    const token = sessionStore.get();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  let requestBody: BodyInit | undefined;
  if (formData) {
    requestBody = formData; // browser sets the multipart boundary header
  } else if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    requestBody = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: requestBody,
    });
  } catch {
    return { ok: false, error: ApiError.network() };
  }

  if (response.ok) {
    if (response.status === 204) {
      return { ok: true, data: undefined as T };
    }
    try {
      return { ok: true, data: (await response.json()) as T };
    } catch {
      return { ok: false, error: ApiError.network() };
    }
  }

  const error = await parseErrorBody(response);
  if (error.code === ErrorCode.UNAUTHORIZED && auth) {
    // Session expiry: discard the session and notify subscribers. No redirect
    // here — navigation is AuthProvider's job (design fix, requirement 2.3).
    sessionStore.clear();
  }
  return { ok: false, error };
}
