import { execSync } from "node:child_process";
import path from "node:path";
import {
  type INestApplication,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/all-exceptions.filter";
import { requestIdMiddleware } from "../src/common/request-id";

const PW = "valid-password-123";

describe("manual-expenses integration (real PostgreSQL)", () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let tokenA = "";
  let tokenB = "";

  const api = () => request(app.getHttpServer());
  const authA = () => ({ authorization: `Bearer ${tokenA}` });
  const authB = () => ({ authorization: `Bearer ${tokenB}` });

  async function token(email: string): Promise<string> {
    await api()
      .post("/api/v1/auth/register")
      .send({ email, password: PW })
      .expect(201);
    const res = await api()
      .post("/api/v1/auth/login")
      .send({ email, password: PW })
      .expect(200);
    return res.body.accessToken as string;
  }

  function createExpense(
    headers: Record<string, string>,
    body: Record<string, unknown>,
  ): request.Test {
    return api().post("/api/v1/expenses").set(headers).send(body);
  }

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
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
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

    tokenA = await token("owner-a@example.com");
    tokenB = await token("other-b@example.com");
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

  it("creates an expense (number amount, YYYY-MM-DD date, server-set type/source)", async () => {
    const res = await createExpense(authA(), {
      amountMinor: 2599,
      currency: "brl",
      expenseDate: "2026-03-01",
      description: "  Lunch  ",
      category: "food",
    }).expect(201);
    expect(res.body).toMatchObject({
      amountMinor: 2599,
      currency: "BRL",
      expenseDate: "2026-03-01",
      description: "Lunch",
      category: "food",
      type: "EXPENSE",
      source: "MANUAL",
    });
    expect(typeof res.body.amountMinor).toBe("number");
    expect(res.body).not.toHaveProperty("passwordHash");
  });

  it("rejects invalid bodies/params with 400", async () => {
    await createExpense(authA(), {
      amountMinor: 0,
      currency: "BRL",
      expenseDate: "2026-03-01",
      description: "x",
    }).expect(400);
    await createExpense(authA(), {
      amountMinor: 100,
      currency: "USD",
      expenseDate: "2026-03-01",
      description: "x",
    }).expect(400);
    await createExpense(authA(), {
      amountMinor: 100,
      currency: "BRL",
      expenseDate: "2026-03-01",
      description: "x".repeat(256),
    }).expect(400);
    await createExpense(authA(), {
      amountMinor: 100,
      currency: "BRL",
      expenseDate: "2026-02-30",
      description: "x",
    }).expect(400);
    await api().get("/api/v1/expenses?pageSize=101").set(authA()).expect(400);
    await api()
      .get("/api/v1/expenses?from=2026-03-02&to=2026-03-01")
      .set(authA())
      .expect(400);
    await api().get("/api/v1/expenses/not-a-uuid").set(authA()).expect(400);
  });

  it("requires authentication", async () => {
    await api().get("/api/v1/expenses").expect(401);
  });

  it("rejects an empty PATCH body with 400", async () => {
    const created = await createExpense(authA(), {
      amountMinor: 500,
      currency: "BRL",
      expenseDate: "2026-03-05",
      description: "Patch target",
    }).expect(201);
    await api()
      .patch(`/api/v1/expenses/${created.body.id}`)
      .set(authA())
      .send({})
      .expect(400);
  });

  it("isolates expenses per user (cross-user → 404)", async () => {
    const created = await createExpense(authA(), {
      amountMinor: 700,
      currency: "BRL",
      expenseDate: "2026-03-06",
      description: "A only",
    }).expect(201);
    const id = created.body.id;
    await api().get(`/api/v1/expenses/${id}`).set(authB()).expect(404);
    await api()
      .patch(`/api/v1/expenses/${id}`)
      .set(authB())
      .send({ amountMinor: 999 })
      .expect(404);
    await api().delete(`/api/v1/expenses/${id}`).set(authB()).expect(404);
    // owner still sees it
    await api().get(`/api/v1/expenses/${id}`).set(authA()).expect(200);
  });

  it("lists own expenses with deterministic order, inclusive range, and meta", async () => {
    const email = "lister@example.com";
    const t = await token(email);
    const h = { authorization: `Bearer ${t}` };
    await createExpense(h, {
      amountMinor: 100,
      currency: "BRL",
      expenseDate: "2026-04-01",
      description: "older",
    }).expect(201);
    await createExpense(h, {
      amountMinor: 200,
      currency: "BRL",
      expenseDate: "2026-04-10",
      description: "newer",
    }).expect(201);

    const all = await api().get("/api/v1/expenses").set(h).expect(200);
    expect(all.body.data).toHaveLength(2);
    expect(all.body.data[0].expenseDate).toBe("2026-04-10"); // desc
    expect(all.body.meta).toEqual({ page: 1, pageSize: 20, total: 2 });

    const filtered = await api()
      .get("/api/v1/expenses?from=2026-04-10&to=2026-04-10")
      .set(h)
      .expect(200);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].expenseDate).toBe("2026-04-10");
  });

  it("updates editable fields and hard-deletes (204 → 404)", async () => {
    const created = await createExpense(authA(), {
      amountMinor: 1000,
      currency: "BRL",
      expenseDate: "2026-05-01",
      description: "Edit me",
    }).expect(201);
    const id = created.body.id;
    const patched = await api()
      .patch(`/api/v1/expenses/${id}`)
      .set(authA())
      .send({ amountMinor: 3000, description: "Edited" })
      .expect(200);
    expect(patched.body).toMatchObject({
      amountMinor: 3000,
      description: "Edited",
      currency: "BRL",
    });

    await api().delete(`/api/v1/expenses/${id}`).set(authA()).expect(204);
    await api().get(`/api/v1/expenses/${id}`).set(authA()).expect(404);
  });

  it("round-trips the calendar date unchanged under a non-UTC timezone", () => {
    // The suite runs with TZ=America/Sao_Paulo (UTC-3); the create test above
    // stored 2026-03-01 and read it back as 2026-03-01 (no shift).
    expect(process.env.TZ).toBe("America/Sao_Paulo");
  });

  it("confirms the stored date reads back unchanged (no tz shift)", async () => {
    const created = await createExpense(authA(), {
      amountMinor: 1,
      currency: "BRL",
      expenseDate: "2026-01-31",
      description: "tz check",
    }).expect(201);
    const got = await api()
      .get(`/api/v1/expenses/${created.body.id}`)
      .set(authA())
      .expect(200);
    expect(got.body.expenseDate).toBe("2026-01-31");
  });
});
