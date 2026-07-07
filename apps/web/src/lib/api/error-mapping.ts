import type { ApiError } from "./api-error";

// The single canonical-code → form UX mapping (requirement 5.1). Known codes
// get our copy — raw backend messages are never the primary UX; the requestId
// is always carried for support correlation.

export interface FormErrorMapping {
  fieldErrors: Record<string, string>;
  formMessage: string | null;
  requestId: string | null;
}

const DEFAULT_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "Invalid credentials.",
  CONFLICT: "This conflicts with an existing record.",
  NOT_FOUND: "The requested record was not found.",
  TOO_MANY_REQUESTS: "Too many attempts. Please try again in a moment.",
  INTERNAL_ERROR: "Something went wrong. Please try again.",
  NETWORK_ERROR: "Could not reach the server. Check your connection and retry.",
};

/**
 * Map an {@link ApiError} to form UX: `VALIDATION_ERROR` details land on the
 * matching known fields (form-level fallback for unmatched ones); other codes
 * become a form-level message, overridable per flow via `messages`.
 */
export function mapApiErrorToForm(
  error: ApiError,
  knownFields: ReadonlyArray<string>,
  messages: Record<string, string> = {},
): FormErrorMapping {
  if (error.code === "VALIDATION_ERROR") {
    const fieldErrors: Record<string, string> = {};
    const unmatched: string[] = [];
    for (const detail of error.details ?? []) {
      if (knownFields.includes(detail.field)) {
        fieldErrors[detail.field] = detail.issue;
      } else {
        // The api emits detail entries with an empty field for whole-payload
        // failures — show just the issue then.
        unmatched.push(
          detail.field ? `${detail.field}: ${detail.issue}` : detail.issue,
        );
      }
    }
    const formMessage =
      unmatched.length > 0
        ? `Some fields are invalid — ${unmatched.join("; ")}.`
        : Object.keys(fieldErrors).length > 0
          ? null
          : "Some fields are invalid.";
    return { fieldErrors, formMessage, requestId: error.requestId };
  }

  return {
    fieldErrors: {},
    formMessage:
      messages[error.code] ??
      DEFAULT_MESSAGES[error.code] ??
      "Something went wrong. Please try again.",
    requestId: error.requestId,
  };
}
