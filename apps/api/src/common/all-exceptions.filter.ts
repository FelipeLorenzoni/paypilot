import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { ErrorCode, type ErrorResponse } from "@paypilot/shared";
import type { RequestWithId } from "./request-id";

/**
 * Global exception filter that converts every error into the canonical
 * {@link ErrorResponse}. Validation failures (400) map to VALIDATION_ERROR with
 * field details; unhandled/5xx errors map to INTERNAL_ERROR with a generic,
 * secret-free message (full detail is logged server-side).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<RequestWithId>();
    const requestId = req.requestId ?? "unknown";
    const timestamp = new Date().toISOString();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCode.INTERNAL_ERROR;
    let message = "Internal server error";
    let details: { field: string; issue: string }[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      if (status === HttpStatus.BAD_REQUEST) {
        code = ErrorCode.VALIDATION_ERROR;
      } else if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        code = ErrorCode.INTERNAL_ERROR;
      } else {
        code = exception.name;
      }

      // Never leak internal detail on 5xx — keep the generic message.
      if (status < HttpStatus.INTERNAL_SERVER_ERROR) {
        if (typeof body === "string") {
          message = body;
        } else if (typeof body === "object" && body !== null) {
          const msg = (body as { message?: string | string[] }).message;
          if (Array.isArray(msg)) {
            message = "Validation failed";
            details = msg.map((issue) => ({ field: "", issue }));
          } else if (typeof msg === "string") {
            message = msg;
          }
        }
      } else {
        this.logger.error(
          `HTTP ${status} [requestId=${requestId}]`,
          exception.stack,
        );
      }
    } else {
      this.logger.error(
        `Unhandled exception [requestId=${requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const errorBody: ErrorResponse = {
      error: {
        code,
        message,
        requestId,
        timestamp,
        ...(details ? { details } : {}),
      },
    };

    res.status(status).json(errorBody);
  }
}
