/**
 * Canonical error contract shared by api and web. The api's global exception
 * filter produces an {@link ErrorResponse}; the web consumes the same shape.
 */
export enum ErrorCode {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

export interface ErrorDetail {
  readonly field: string;
  readonly issue: string;
}

export interface ErrorResponse {
  readonly error: {
    readonly code: ErrorCode | string;
    readonly message: string;
    readonly requestId: string;
    readonly timestamp: string;
    readonly details?: ReadonlyArray<ErrorDetail>;
  };
}
