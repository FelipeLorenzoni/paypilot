import { execSync } from "node:child_process";
import path from "node:path";
import {
  Controller,
  Get,
  type INestApplication,
  Module,
  Param,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Throttle } from "@nestjs/throttler";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { Express } from "express";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { CurrentUser } from "../src/auth/current-user.decorator";
import { JwtTokenService } from "../src/auth/jwt-token.service";
import type { SafeUser } from "../src/auth/safe-user";
import { AllExceptionsFilter } from "../src/common/all-exceptions.filter";
import { assertOwnership } from "../src/common/ownership";
import { requestIdMiddleware } from "../src/common/request-id";
import { PrismaService } from "../src/prisma/prisma.service";
import { UsersRepository } from "../src/users/users.repository";

// Test-only protected resources (declared in the suite, never in production)
// to validate per-user isolation and the guard-order proof.
@Controller("__test")
class TestProtectedController {
  @Get("notes/:ownerId")
  note(
    @Param("ownerId") ownerId: string,
    @CurrentUser() user: SafeUser,
  ): { ownerId: string } {
    assertOwnership(ownerId, user.id);
    return { ownerId };
  }

  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  @Get("throttle-probe")
  probe(@CurrentUser() user: SafeUser): { id: string } {
    return { id: user.id };
  }
}

@Module({ imports: [AppModule], controllers: [TestProtectedController] })
class AuthTestModule {}

const PASSWORD = "valid-password-123";

describe("auth-jwt integration (real PostgreSQL)", () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;

  // Per-test client IP so each test has isolated throttle counters; within a
  // single test the same IP is reused so rate-limit tests can trip the limit.
  let ipCounter = 0;
  let currentIp = "";

  function client(): {
    get: (url: string) => request.Test;
    post: (url: string) => request.Test;
  } {
    const base = request(app.getHttpServer());
    return {
      get: (url) => base.get(url).set("x-forwarded-for", currentIp),
      post: (url) => base.post(url).set("x-forwarded-for", currentIp),
    };
  }

  beforeEach(() => {
    ipCounter += 1;
    currentIp = `10.1.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
  });

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    const url = container.getConnectionUri();
    process.env.DATABASE_URL = url;
    process.env.JWT_SECRET ??= "test-secret-at-least-16-chars";

    execSync("pnpm exec prisma migrate deploy", {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AuthTestModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    // Trust X-Forwarded-For so the throttler keys on our per-test IP.
    app.getHttpAdapter().getInstance<Express>().set("trust proxy", true);
    app.use(requestIdMiddleware);
    app.setGlobalPrefix("api");
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    try {
      await app?.close();
    } catch {
      /* ignore */
    }
    try {
      await container?.stop();
    } catch {
      /* ignore */
    }
  });

  async function registerAndLogin(
    email: string,
  ): Promise<{ id: string; token: string }> {
    const reg = await client()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD })
      .expect(201);
    const login = await client()
      .post("/api/v1/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);
    return { id: reg.body.id, token: login.body.accessToken };
  }

  it("registers a user and returns a SafeUser without the password hash", async () => {
    const res = await client()
      .post("/api/v1/auth/register")
      .send({ email: "alice@example.com", password: PASSWORD })
      .expect(201);
    expect(res.body).toMatchObject({ email: "alice@example.com" });
    expect(res.body.id).toBeDefined();
    expect(res.body).not.toHaveProperty("passwordHash");
  });

  it("rejects a duplicate email with 409 CONFLICT", async () => {
    await client()
      .post("/api/v1/auth/register")
      .send({ email: "dup@example.com", password: PASSWORD })
      .expect(201);
    const res = await client()
      .post("/api/v1/auth/register")
      .send({ email: "DUP@example.com", password: PASSWORD }) // normalized → same
      .expect(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("rejects an invalid registration body with 400 VALIDATION_ERROR", async () => {
    const res = await client()
      .post("/api/v1/auth/register")
      .send({ email: "bad", password: "short" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("logs in with valid credentials; rejects invalid with a generic 401", async () => {
    await client()
      .post("/api/v1/auth/register")
      .send({ email: "bob@example.com", password: PASSWORD })
      .expect(201);
    const ok = await client()
      .post("/api/v1/auth/login")
      .send({ email: "bob@example.com", password: PASSWORD })
      .expect(200);
    expect(typeof ok.body.accessToken).toBe("string");

    const bad = await client()
      .post("/api/v1/auth/login")
      .send({ email: "bob@example.com", password: "wrong-password-xx" })
      .expect(401);
    expect(bad.body.error.code).toBe("UNAUTHORIZED");
  });

  it("GET /auth/me returns the safe profile for a valid token", async () => {
    const { id, token } = await registerAndLogin("carol@example.com");
    const res = await client()
      .get("/api/v1/auth/me")
      .set("authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body).toEqual({
      id,
      email: "carol@example.com",
      createdAt: expect.any(String),
    });
    expect(res.body).not.toHaveProperty("passwordHash");
  });

  it("GET /auth/me rejects missing and invalid tokens with 401", async () => {
    await client().get("/api/v1/auth/me").expect(401);
    await client()
      .get("/api/v1/auth/me")
      .set("authorization", "Bearer not-a-valid-token")
      .expect(401);
  });

  it("rejects a token whose user has been disabled", async () => {
    const { id, token } = await registerAndLogin("dave@example.com");
    await app
      .get(PrismaService)
      .user.update({ where: { id }, data: { isActive: false } });
    await client()
      .get("/api/v1/auth/me")
      .set("authorization", `Bearer ${token}`)
      .expect(401);
  });

  it("keeps health public and isolates per-user resources (404-like cross-user)", async () => {
    await client().get("/api/v1/health/live").expect(200);

    const owner = await registerAndLogin("owner@example.com");
    const other = await registerAndLogin("other@example.com");

    await client()
      .get(`/api/v1/__test/notes/${owner.id}`)
      .set("authorization", `Bearer ${owner.token}`)
      .expect(200);

    await client()
      .get(`/api/v1/__test/notes/${owner.id}`)
      .set("authorization", `Bearer ${other.token}`)
      .expect(404);
  });

  it("rate-limits login attempts with 429 TOO_MANY_REQUESTS", async () => {
    let got429 = false;
    for (let i = 0; i < 12; i += 1) {
      const res = await client()
        .post("/api/v1/auth/login")
        .send({ email: "ratelimit@example.com", password: "whatever-12chars" });
      if (res.status === 429) {
        expect(res.body.error.code).toBe("TOO_MANY_REQUESTS");
        got429 = true;
        break;
      }
    }
    expect(got429).toBe(true);
  });

  it("throttles BEFORE authentication (guard order proof)", async () => {
    const { token } = await registerAndLogin("guardorder@example.com");
    const tokenSpy = jest.spyOn(app.get(JwtTokenService), "verify");
    const lookupSpy = jest.spyOn(app.get(UsersRepository), "findActiveById");

    // Consume the probe route's limit (2) with a valid token.
    await client()
      .get("/api/v1/__test/throttle-probe")
      .set("authorization", `Bearer ${token}`)
      .expect(200);
    await client()
      .get("/api/v1/__test/throttle-probe")
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    tokenSpy.mockClear();
    lookupSpy.mockClear();

    await client()
      .get("/api/v1/__test/throttle-probe")
      .set("authorization", `Bearer ${token}`)
      .expect(429);

    expect(tokenSpy).not.toHaveBeenCalled();
    expect(lookupSpy).not.toHaveBeenCalled();
    tokenSpy.mockRestore();
    lookupSpy.mockRestore();
  });
});
