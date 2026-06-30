import {
  type ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ErrorCode } from "@paypilot/shared";
import { AllExceptionsFilter } from "./all-exceptions.filter";

type ErrorBody = {
  error: {
    code: string;
    message: string;
    requestId: string;
    timestamp: string;
    details?: ReadonlyArray<{ field: string; issue: string }>;
  };
};

function run(exception: unknown): { status: number; body: ErrorBody } {
  const filter = new AllExceptionsFilter();
  let status = 0;
  let body: unknown;
  const res = {
    status: (code: number) => {
      status = code;
      return { json: (payload: unknown) => (body = payload) };
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ requestId: "req-1" }),
    }),
  } as unknown as ArgumentsHost;
  filter.catch(exception, host);
  return { status, body: body as ErrorBody };
}

describe("AllExceptionsFilter status -> ErrorCode mapping", () => {
  it("maps 401 to UNAUTHORIZED", () => {
    const { status, body } = run(new UnauthorizedException());
    expect(status).toBe(401);
    expect(body.error.code).toBe(ErrorCode.UNAUTHORIZED);
  });

  it("maps 403 to FORBIDDEN", () => {
    expect(run(new ForbiddenException()).body.error.code).toBe(
      ErrorCode.FORBIDDEN,
    );
  });

  it("maps 404 to NOT_FOUND", () => {
    expect(run(new NotFoundException()).body.error.code).toBe(
      ErrorCode.NOT_FOUND,
    );
  });

  it("maps 409 to CONFLICT", () => {
    expect(run(new ConflictException()).body.error.code).toBe(
      ErrorCode.CONFLICT,
    );
  });

  it("maps 429 to TOO_MANY_REQUESTS", () => {
    const { status, body } = run(
      new HttpException("rate", HttpStatus.TOO_MANY_REQUESTS),
    );
    expect(status).toBe(429);
    expect(body.error.code).toBe(ErrorCode.TOO_MANY_REQUESTS);
  });

  describe("foundation behavior preserved", () => {
    it("keeps 400 as VALIDATION_ERROR with details", () => {
      const { status, body } = run(
        new BadRequestException({ message: ["email must be valid"] }),
      );
      expect(status).toBe(400);
      expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(body.error.details).toBeDefined();
    });

    it("keeps 5xx as generic INTERNAL_ERROR (no leak)", () => {
      const { status, body } = run(
        new InternalServerErrorException("db dsn leak"),
      );
      expect(status).toBe(500);
      expect(body.error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(body.error.message).toBe("Internal server error");
      expect(JSON.stringify(body)).not.toContain("db dsn leak");
    });

    it("maps unknown (non-HttpException) errors to 500 INTERNAL_ERROR", () => {
      const { status, body } = run(new Error("boom"));
      expect(status).toBe(500);
      expect(body.error.code).toBe(ErrorCode.INTERNAL_ERROR);
    });

    it("always includes requestId and ISO timestamp", () => {
      const { body } = run(new UnauthorizedException());
      expect(body.error.requestId).toBe("req-1");
      expect(typeof body.error.timestamp).toBe("string");
    });
  });
});
