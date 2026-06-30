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
import { PrismaService } from "../src/prisma/prisma.service";
import { GenerationService } from "../src/recurring-bills/generation.service";

const PW = "valid-password-123";

describe("recurring-bills integration (real PostgreSQL)", () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;
  let generation: GenerationService;
  let tokenA = "";
  let tokenB = "";
  let userAId = "";

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

  function createBill(
    headers: Record<string, string>,
    body: Record<string, unknown>,
  ): request.Test {
    return api().post("/api/v1/recurring-bills").set(headers).send(body);
  }

  const baseBill = (overrides: Record<string, unknown> = {}) => ({
    amountMinor: 5000,
    currency: "BRL",
    dayOfMonth: 10,
    description: "Rent",
    startDate: "2026-01-01",
    ...overrides,
  });

  function billRowCount(billId: string, period: string): Promise<number> {
    return prisma.transaction.count({
      where: { recurringBillId: billId, periodKey: period },
    });
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

    prisma = app.get(PrismaService);
    generation = app.get(GenerationService);

    tokenA = await token("rb-owner-a@example.com");
    tokenB = await token("rb-other-b@example.com");
    const userA = await prisma.user.findUniqueOrThrow({
      where: { email: "rb-owner-a@example.com" },
    });
    userAId = userA.id;
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

  // --- CRUD + validation ---

  it("creates a recurring bill (number amount, normalized currency, defaults)", async () => {
    const res = await createBill(authA(), {
      amountMinor: 2599,
      currency: "brl",
      dayOfMonth: 5,
      description: "  Netflix  ",
      category: "subs",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    }).expect(201);
    expect(res.body).toMatchObject({
      amountMinor: 2599,
      currency: "BRL",
      dayOfMonth: 5,
      description: "Netflix",
      category: "subs",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      isActive: true,
    });
    expect(typeof res.body.amountMinor).toBe("number");
  });

  it("rejects invalid bodies/params with 400", async () => {
    await createBill(authA(), baseBill({ amountMinor: 0 })).expect(400);
    await createBill(authA(), baseBill({ currency: "USD" })).expect(400);
    await createBill(authA(), baseBill({ dayOfMonth: 0 })).expect(400);
    await createBill(authA(), baseBill({ dayOfMonth: 32 })).expect(400);
    await createBill(
      authA(),
      baseBill({ description: "x".repeat(256) }),
    ).expect(400);
    await createBill(
      authA(),
      baseBill({ startDate: "2026-06-01", endDate: "2026-05-01" }),
    ).expect(400);
    await api()
      .get("/api/v1/recurring-bills?pageSize=101")
      .set(authA())
      .expect(400);
    await api()
      .get("/api/v1/recurring-bills/not-a-uuid")
      .set(authA())
      .expect(400);
  });

  it("parses the active query param explicitly (true/false ok, other → 400)", async () => {
    await api()
      .get("/api/v1/recurring-bills?active=true")
      .set(authA())
      .expect(200);
    await api()
      .get("/api/v1/recurring-bills?active=false")
      .set(authA())
      .expect(200);
    await api()
      .get("/api/v1/recurring-bills?active=1")
      .set(authA())
      .expect(400);
    await api()
      .get("/api/v1/recurring-bills?active=yes")
      .set(authA())
      .expect(400);
  });

  it("requires authentication", async () => {
    await api().get("/api/v1/recurring-bills").expect(401);
  });

  it("rejects an empty PATCH body with 400", async () => {
    const created = await createBill(authA(), baseBill()).expect(201);
    await api()
      .patch(`/api/v1/recurring-bills/${created.body.id}`)
      .set(authA())
      .send({})
      .expect(400);
  });

  it("isolates bills per user (cross-user → 404)", async () => {
    const created = await createBill(
      authA(),
      baseBill({ description: "A only" }),
    ).expect(201);
    const id = created.body.id;
    await api().get(`/api/v1/recurring-bills/${id}`).set(authB()).expect(404);
    await api()
      .patch(`/api/v1/recurring-bills/${id}`)
      .set(authB())
      .send({ amountMinor: 999 })
      .expect(404);
    await api()
      .delete(`/api/v1/recurring-bills/${id}`)
      .set(authB())
      .expect(404);
    await api().get(`/api/v1/recurring-bills/${id}`).set(authA()).expect(200);
  });

  // --- DELETE = deactivate (preserve generated history) ---

  it("DELETE deactivates (204) and preserves generated transactions", async () => {
    const created = await createBill(
      authA(),
      baseBill({ dayOfMonth: 10, startDate: "2026-01-01", description: "Gym" }),
    ).expect(201);
    const id = created.body.id;
    await generation.generateForPeriod("2026-03");
    expect(await billRowCount(id, "2026-03")).toBe(1);

    await api()
      .delete(`/api/v1/recurring-bills/${id}`)
      .set(authA())
      .expect(204);
    const got = await api()
      .get(`/api/v1/recurring-bills/${id}`)
      .set(authA())
      .expect(200);
    expect(got.body.isActive).toBe(false);
    // The already-generated transaction still exists.
    expect(await billRowCount(id, "2026-03")).toBe(1);
  });

  // --- Idempotency (financial-rules R3) ---

  it("is idempotent: re-running a period never duplicates or mutates a row", async () => {
    const created = await createBill(
      authA(),
      baseBill({
        dayOfMonth: 15,
        startDate: "2026-01-01",
        description: "Idem",
      }),
    ).expect(201);
    const id = created.body.id;

    await generation.generateForPeriod("2030-06");
    expect(await billRowCount(id, "2030-06")).toBe(1);
    const first = await prisma.transaction.findFirstOrThrow({
      where: { recurringBillId: id, periodKey: "2030-06" },
    });

    const summary = await generation.generateForPeriod("2030-06");
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    expect(await billRowCount(id, "2030-06")).toBe(1);
    const second = await prisma.transaction.findFirstOrThrow({
      where: { recurringBillId: id, periodKey: "2030-06" },
    });
    // No mutation: same row, same timestamps/values.
    expect(second.id).toBe(first.id);
    expect(second.createdAt.toISOString()).toBe(first.createdAt.toISOString());
    expect(second.amountMinor).toBe(first.amountMinor);
  });

  it("is concurrency-safe: parallel runs converge to exactly one row", async () => {
    const created = await createBill(
      authA(),
      baseBill({
        dayOfMonth: 20,
        startDate: "2026-01-01",
        description: "Race",
      }),
    ).expect(201);
    const id = created.body.id;

    await Promise.all([
      generation.generateForPeriod("2030-07"),
      generation.generateForPeriod("2030-07"),
    ]);
    expect(await billRowCount(id, "2030-07")).toBe(1);
  });

  // --- Eligibility + clamp + snapshot ---

  it("generates zero for inactive or out-of-window bills", async () => {
    const before = await createBill(
      authA(),
      baseBill({ startDate: "2031-01-01", description: "Future start" }),
    ).expect(201);
    const after = await createBill(
      authA(),
      baseBill({
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        description: "Ended",
      }),
    ).expect(201);
    const inactive = await createBill(
      authA(),
      baseBill({ startDate: "2026-01-01", description: "Inactive" }),
    ).expect(201);
    await api()
      .delete(`/api/v1/recurring-bills/${inactive.body.id}`)
      .set(authA())
      .expect(204);

    await generation.generateForPeriod("2030-08");
    expect(await billRowCount(before.body.id, "2030-08")).toBe(0); // not yet started
    expect(await billRowCount(after.body.id, "2030-08")).toBe(0); // window ended
    expect(await billRowCount(inactive.body.id, "2030-08")).toBe(0); // inactive
  });

  it("clamps day-of-month to the last day of short months", async () => {
    const created = await createBill(
      authA(),
      baseBill({
        dayOfMonth: 31,
        startDate: "2020-01-01",
        description: "Clamp",
      }),
    ).expect(201);
    const id = created.body.id;

    await generation.generateForPeriod("2026-02"); // non-leap → 28
    await generation.generateForPeriod("2024-02"); // leap → 29
    await generation.generateForPeriod("2026-04"); // 30-day month

    const rows = await prisma.transaction.findMany({
      where: { recurringBillId: id },
      orderBy: { periodKey: "asc" },
    });
    const byPeriod = Object.fromEntries(
      rows.map((r) => [
        r.periodKey,
        r.transactionDate.toISOString().slice(0, 10),
      ]),
    );
    expect(byPeriod["2024-02"]).toBe("2024-02-29");
    expect(byPeriod["2026-02"]).toBe("2026-02-28");
    expect(byPeriod["2026-04"]).toBe("2026-04-30");
  });

  it("snapshots bill values and classifies the generated row", async () => {
    const created = await createBill(
      authA(),
      baseBill({
        amountMinor: 12345,
        dayOfMonth: 8,
        description: "Snapshot",
        category: "bills",
        startDate: "2026-01-01",
      }),
    ).expect(201);
    const id = created.body.id;
    await generation.generateForPeriod("2030-09");
    const row = await prisma.transaction.findFirstOrThrow({
      where: { recurringBillId: id, periodKey: "2030-09" },
    });
    expect(row.type).toBe("EXPENSE");
    expect(row.source).toBe("RECURRING");
    expect(row.userId).toBe(userAId);
    expect(row.amountMinor).toBe(12345n);
    expect(row.currency).toBe("BRL");
    expect(row.description).toBe("Snapshot");
    expect(row.categoryLabel).toBe("bills");
    expect(row.transactionDate.toISOString().slice(0, 10)).toBe("2030-09-08");
  });

  // --- Source protection (R13) ---

  it("manual expense endpoints cannot see or mutate a RECURRING row", async () => {
    const created = await createBill(
      authA(),
      baseBill({
        dayOfMonth: 12,
        startDate: "2026-01-01",
        description: "Protected",
      }),
    ).expect(201);
    await generation.generateForPeriod("2030-10");
    const recurringTx = await prisma.transaction.findFirstOrThrow({
      where: { recurringBillId: created.body.id, periodKey: "2030-10" },
    });

    // Not listed by the manual expenses endpoint.
    const list = await api()
      .get("/api/v1/expenses?pageSize=100")
      .set(authA())
      .expect(200);
    const ids = (list.body.data as Array<{ id: string }>).map((e) => e.id);
    expect(ids).not.toContain(recurringTx.id);

    // Not readable/updatable/deletable as a manual expense.
    await api()
      .get(`/api/v1/expenses/${recurringTx.id}`)
      .set(authA())
      .expect(404);
    await api()
      .patch(`/api/v1/expenses/${recurringTx.id}`)
      .set(authA())
      .send({ amountMinor: 1 })
      .expect(404);
    await api()
      .delete(`/api/v1/expenses/${recurringTx.id}`)
      .set(authA())
      .expect(404);

    // The row is untouched.
    const still = await prisma.transaction.findUniqueOrThrow({
      where: { id: recurringTx.id },
    });
    expect(still.source).toBe("RECURRING");
  });

  // --- CHECK constraint: both invalid link states rejected ---

  it("rejects invalid recurring-link states at the database (CHECK)", async () => {
    const bill = await createBill(
      authA(),
      baseBill({ description: "Check src" }),
    ).expect(201);

    // (1) RECURRING without recurringBillId/periodKey.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO transactions
           (id, "userId", type, source, "amountMinor", currency, "transactionDate", description, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, 'EXPENSE', 'RECURRING', 100, 'BRL', '2099-01-01', 'bad', now(), now())`,
        userAId,
      ),
    ).rejects.toThrow();

    // (2) MANUAL with recurringBillId/periodKey populated (FK satisfied first).
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO transactions
           (id, "userId", type, source, "amountMinor", currency, "transactionDate", description, "recurringBillId", "periodKey", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, 'EXPENSE', 'MANUAL', 100, 'BRL', '2099-01-01', 'bad', $2, '2099-01', now(), now())`,
        userAId,
        bill.body.id,
      ),
    ).rejects.toThrow();
  });
});
