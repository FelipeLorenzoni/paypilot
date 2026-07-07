import { ErrorCode, type ErrorDetail } from "@paypilot/shared";

/** Canonical code, or the client-side code for unreachable/unparseable failures. */
export type ApiErrorCode = ErrorCode | "NETWORK_ERROR" | string;

const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  "NETWORK_ERROR",
  ErrorCode.INTERNAL_ERROR,
  ErrorCode.TOO_MANY_REQUESTS,
]);

/**
 * The single failure shape surfaced by the api client. Expected failures are
 * returned as values (`ApiResult`), never thrown into React.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly requestId: string | null;
  readonly details?: ReadonlyArray<ErrorDetail>;

  constructor(input: {
    code: ApiErrorCode;
    message: string;
    requestId?: string | null;
    details?: ReadonlyArray<ErrorDetail>;
  }) {
    super(input.message);
    this.name = "ApiError";
    this.code = input.code;
    this.requestId = input.requestId ?? null;
    this.details = input.details;
  }

  /** Whether the operation is safely repeatable from the UI (requirement 5.2). */
  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.code);
  }

  static network(): ApiError {
    return new ApiError({
      code: "NETWORK_ERROR",
      message: "Could not reach the server. Check your connection and retry.",
    });
  }
}

export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; error: ApiError };
