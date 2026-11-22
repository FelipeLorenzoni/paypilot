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
import { CLOCK } from "../src/common/clock";
import { requestIdMiddleware } from "../src/common/request-id";
import { PrismaService } from "../src/prisma/prisma.service";
import { GenerationService } from "../src/recurring-bills/generation.service";

const PW = "valid-password-123";
/** "Today" for every request: 2026-11-21 (UTC). */
const NOW = new Date("2026-11-21T12:00:00.000Z");
// Fixed by default; a test may move it and must restore NOW afterwards.
const clock = {
  instant: NOW,
  now(): Date {
    return this.instant;
  },
};

describe("monthly-dashboard integration (real PostgreSQL)", () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;
  let generation: GenerationService;

  let tokenA = "";
  let tokenB = "";
  let condoBillId = "";
  let internetBillId = "";
  let cardId = "";

  const api = () => request(app.getHttpServer());
  const authA = () => ({ authorization: `Bearer ${tokenA}` });
  const authB = () => ({ authorization: `Bearer ${tokenB}` });

  async function register(email: string): Promise<string> {
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

  async function createBill(
    dayOfMonth: number,
    description: string,
    amountMinor: number,
  ): Promise<string> {
    const res = await api()
      .post("/api/v1/recurring-bills")
      .set(authA())
      .send({
        amountMinor,
        currency: "BRL",
        dayOfMonth,
        description,
        startDate: "2026-01-01",
      })
      .expect(201);
    return res.body.id as string;
  }

  async function billTxnId(billId: string, period: string): Promise<string> {
    const row = await prisma.transaction.findFirstOrThrow({
      where: { recurringBillId: billId, periodKey: period },
    });
    return row.id;
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
    })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
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

    tokenA = await register("dash-a@example.com");
    tokenB = await register("dash-b@example.com");

    // RECURRING: condo occurrences 4 months back (outside the look-back
    // window), 2 months back (inside it) and this month; internet only this
    // month (created after the earlier periods were generated).
    condoBillId = await createBill(10, "Condo", 85048);
    await generation.generateForPeriod("2026-07");
    await generation.generateForPeriod("2026-09");
    internetBillId = await createBill(25, "Internet", 12000);
    await generation.generateForPeriod("2026-11");

    // CARD: two purchases of one invoice (cycle 2026-11, due 2026-11-20).
    const card = await api()
      .post("/api/v1/credit-cards")
      .set(authA())
      .send({ label: "Visa Gold", closingDay: 10, dueDay: 20 })
      .expect(201);
    cardId = card.body.id as string;
    for (const [key, amount] of [
      ["p1", 10000],
      ["p2", 2550],
    ] as const) {
      await api()
        .post(`/api/v1/credit-cards/${cardId}/purchases`)
        .set(authA())
        .send({
          idempotencyKey: `dash-${key}`,
          purchaseDate: "2026-11-05",
          amountMinor: amount,
          currency: "BRL",
          description: `Purchase ${key}`,
          installments: 1,
        })
        .expect(201);
    }

    // MANUAL and IMPORTED rows of the month.
    await api()
      .post("/api/v1/expenses")
      .set(authA())
      .send({
        amountMinor: 5000,
        currency: "BRL",
        expenseDate: "2026-11-03",
        description: "Groceries",
        category: "Food",
      })
      .expect(201);
    await api()
      .post("/api/v1/imports")
      .set(authA())
      .attach(
        "file",
        Buffer.from("date,amount,description\n2026-11-04,10.00,coffee", "utf8"),
        "statement.csv",
      )
      .expect(201);

    // User B: one manual expense in the same month.
    await api()
      .post("/api/v1/expenses")
      .set(authB())
      .send({
        amountMinor: 777,
        currency: "BRL",
        expenseDate: "2026-11-15",
        description: "B only",
      })
      .expect(201);

    // The month's condo occurrence is paid through the existing endpoint.
    await api()
      .put("/api/v1/reminders/paid")
      .set(authA())
      .send({
        targetType: "RECURRING_TRANSACTION",
        transactionId: await billTxnId(condoBillId, "2026-11"),
        paid: true,
      })
      .expect(200);
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

  it("summarizes all four sources of the current month under the fixed clock", async () => {
    const res = await api()
      .get("/api/v1/dashboard/summary")
      .set(authA())
      .expect(200);

    expect(res.body).toMatchObject({
      month: "2026-11",
      monthStart: "2026-11-01",
      monthEnd: "2026-11-30",
      today: "2026-11-21",
      overdueLookbackFrom: "2026-08",
      hasActivity: true,
    });
    expect(res.body.currencies).toHaveLength(1);
    expect(res.body.currencies[0]).toMatchObject({
      currency: "BRL",
      // 5000 + (85048 + 12000) + (10000 + 2550) + 1000
      totalMinor: 115598,
      bySource: [
        { source: "MANUAL", amountMinor: 5000 },
        { source: "RECURRING", amountMinor: 97048 },
        { source: "CARD", amountMinor: 12550 },
        { source: "IMPORTED", amountMinor: 1000 },
      ],
    });
  });

  it("lists overdue, carried-over, due and paid items with their status", async () => {
    const res = await api()
      .get("/api/v1/dashboard/summary")
      .set(authA())
      .expect(200);

    const condoSep = await billTxnId(condoBillId, "2026-09");
    const condoNov = await billTxnId(condoBillId, "2026-11");
    const internetNov = await billTxnId(internetBillId, "2026-11");
    const condoJul = await billTxnId(condoBillId, "2026-07");

    expect(
      res.body.dueItems.map(
        (i: { targetKey: string; status: string; carriedOver: boolean }) => [
          i.targetKey,
          i.status,
          i.carriedOver,
        ],
      ),
    ).toEqual([
      [`txn:${condoSep}`, "OVERDUE", true],
      [`card:${cardId}:2026-11`, "OVERDUE", false],
      [`txn:${internetNov}`, "DUE", false],
      [`txn:${condoNov}`, "PAID", false],
    ]);
    // Four months back is outside the look-back window.
    expect(JSON.stringify(res.body.dueItems)).not.toContain(condoJul);

    const invoice = res.body.dueItems[1];
    expect(invoice).toMatchObject({
      targetType: "CARD_INVOICE",
      description: "Visa Gold",
      dueDate: "2026-11-20",
      amountMinor: 12550,
    });
    expect(res.body.dueItems[3].paidAt).not.toBeNull();

    expect(res.body.dueTotals).toEqual([
      {
        currency: "BRL",
        overdueCount: 2,
        overdueMinor: 85048 + 12550,
        dueCount: 1,
        dueMinor: 12000,
      },
    ]);
  });

  it("keeps each user's summary to their own rows", async () => {
    const res = await api()
      .get("/api/v1/dashboard/summary")
      .set(authB())
      .expect(200);

    expect(res.body.currencies[0].totalMinor).toBe(777);
    expect(res.body.dueItems).toEqual([]);
    expect(res.body.dueTotals).toEqual([]);
  });

  it("reads an explicit month and returns a zeroed summary for an empty one", async () => {
    const res = await api()
      .get("/api/v1/dashboard/summary?month=2026-10")
      .set(authA())
      .expect(200);

    expect(res.body.hasActivity).toBe(false);
    expect(res.body.currencies[0].totalMinor).toBe(0);
    // The September and July condo rows are both inside Oct's window and unpaid.
    expect(res.body.dueItems).toHaveLength(2);
    expect(
      res.body.dueItems.every(
        (i: { status: string; carriedOver: boolean }) =>
          i.status === "OVERDUE" && i.carriedOver,
      ),
    ).toBe(true);
  });

  it("never writes: ledger and marker counts are unchanged by a request", async () => {
    const before = [
      await prisma.transaction.count(),
      await prisma.paymentMarker.count(),
    ];

    await api().get("/api/v1/dashboard/summary").set(authA()).expect(200);

    expect([
      await prisma.transaction.count(),
      await prisma.paymentMarker.count(),
    ]).toEqual(before);
  });

  it("rejects a malformed month and requires authentication", async () => {
    const res = await api()
      .get("/api/v1/dashboard/summary?month=2026-13")
      .set(authA())
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");

    await api().get("/api/v1/dashboard/summary").expect(401);
  });

  it("keeps the business month until local midnight on the 1st (app-timezone)", async () => {
    // 23:00 on Nov 30 in São Paulo is already Dec 1 in UTC.
    clock.instant = new Date("2026-12-01T02:00:00.000Z");
    try {
      const res = await api()
        .get("/api/v1/dashboard/summary")
        .set(authA())
        .expect(200);

      expect(res.body).toMatchObject({ month: "2026-11", today: "2026-11-30" });
      const internet = await billTxnId(internetBillId, "2026-11");
      expect(
        res.body.dueItems.find(
          (item: { targetKey: string }) => item.targetKey === `txn:${internet}`,
        ),
      ).toMatchObject({ dueDate: "2026-11-25", status: "OVERDUE" });
    } finally {
      clock.instant = NOW;
    }
  });
});
