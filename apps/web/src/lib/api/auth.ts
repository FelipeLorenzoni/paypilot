import type {
  AuthCredentials,
  AuthTokenResponse,
  MeResponse,
} from "@paypilot/shared";
import type { ApiResult } from "./api-error";
import { request } from "./http";

export function register(
  credentials: AuthCredentials,
): Promise<ApiResult<MeResponse>> {
  return request("/auth/register", {
    method: "POST",
    body: credentials,
    auth: false,
  });
}

export function login(
  credentials: AuthCredentials,
): Promise<ApiResult<AuthTokenResponse>> {
  return request("/auth/login", {
    method: "POST",
    body: credentials,
    auth: false,
  });
}

export function getMe(): Promise<ApiResult<MeResponse>> {
  return request("/auth/me");
}
