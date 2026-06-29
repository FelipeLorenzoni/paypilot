import {
  Body,
  Controller,
  type INestApplication,
  Module,
  Post,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { IsNotEmpty, IsString } from "class-validator";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/all-exceptions.filter";
import { requestIdMiddleware } from "../src/common/request-id";
import { PrismaService } from "../src/prisma/prisma.service";

// Test-only DTO + controller declared inside the test suite (not a production
// endpoint) to exercise the global ValidationPipe + AllExceptionsFilter.
class CreateProbeDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}

@Controller("__test/probe")
class TestProbeController {
  @Post()
  create(@Body() dto: CreateProbeDto): { ok: true; name: string } {
    return { ok: true, name: dto.name };
  }
}

@Module({ imports: [AppModule], controllers: [TestProbeController] })
class IntegrationTestModule {}

describe("Foundation integration (real PostgreSQL via Testcontainers)", () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    // PrismaService reads DATABASE_URL via validated AppConfig at module init.
    process.env.DATABASE_URL = container.getConnectionUri();

    const moduleRef = await Test.createTestingModule({
      imports: [IntegrationTestModule],
    }).compile();

    app = moduleRef.createNestApplication();
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
      // ignore (DB may already be stopped by the last test)
    }
    try {
      await container?.stop();
    } catch {
      // ignore (already stopped)
    }
  });

  it("PrismaService connects to PostgreSQL and runs a trivial query", async () => {
    const prisma = app.get(PrismaService);
    await expect(prisma.isHealthy()).resolves.toBe(true);
  });

  it("GET /api/v1/health/live returns 200", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/health/live")
      .expect(200, { status: "up" });
  });

  it("GET /api/v1/health/ready returns 200 while the DB is up", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/health/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "up", checks: { database: "up" } });
  });

  it("echoes an incoming x-request-id header", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/health/live")
      .set("x-request-id", "probe-xyz");
    expect(res.headers["x-request-id"]).toBe("probe-xyz");
  });

  it("rejects an invalid body with 400 VALIDATION_ERROR (canonical envelope)", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/__test/probe")
      .send({})
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(typeof res.body.error.requestId).toBe("string");
    expect(typeof res.body.error.timestamp).toBe("string");
  });

  it("GET /api/v1/health/ready returns 503 when the DB is down", async () => {
    await container.stop();
    const res = await request(app.getHttpServer()).get("/api/v1/health/ready");
    expect(res.status).toBe(503);
  });
});
