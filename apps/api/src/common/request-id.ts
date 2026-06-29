import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const REQUEST_ID_HEADER = "x-request-id";

/** Request augmented with the resolved correlation id. */
export type RequestWithId = Request & { requestId: string };

/**
 * Resolve the correlation id for a request: use a non-empty incoming
 * `x-request-id` header when present, otherwise generate a UUID v4.
 */
export function resolveRequestId(incoming?: string | string[]): string {
  const value = Array.isArray(incoming) ? incoming[0] : incoming;
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return randomUUID();
}

/**
 * Express middleware that attaches the request id to the request (for the
 * exception filter and logging) and echoes it on the response header.
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
  (req as RequestWithId).requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}
