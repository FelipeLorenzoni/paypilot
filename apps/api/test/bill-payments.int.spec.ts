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
import {
  NOTIFICATION_PROVIDER,
  type NotificationProvider,
  type NotificationResult,
  type OutboundNotification,
} from "../src/integrations/notifications/notification-provider";
import { PrismaService } from "../src/prisma/prisma.service";
import { GenerationService } from "../src/recurring-bills/generation.service";
import { ReminderEvaluationService } from "../src/reminders/reminder-evaluation.service";

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

/** Recording fake provider — no external calls. */
class RecordingProvider implements NotificationProvider {
  sends: OutboundNotification[] = [];

  send(notification: OutboundNotification): Promise<NotificationResult> {
    this.sends.push(notification);
    return Promise.resolve({ ok: true });
  }
}

describe("bill-payments integration (real PostgreSQL)", () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;
  let evaluation: ReminderEvaluationService;
  const provider = new RecordingProvider();

  let tokenA = "";
  let tokenB = "";
  let condoTxnId = "";
  let internetTxnId = "";
  let cardId = "";
  let manualId = "";
  let importedId = "";

  const api = () => request(app.getHttpServer());
  const authA = () => ({ authorization: `Bearer ${tokenA}` });
  const authB = () => ({ authorization: `Bearer ${tokenB}` });

  const pay = (
    headers: Record<string, string>,
    body: Record<string, unknown>,
  ) => api().put("/api/v1/bill-payments").set(headers).send(body);
  const condo = (extra: Record<string, unknown> = {}) => ({
    targetType: "RECURRING_TRANSACTION",
    transactionId: condoTxnId,
    ...extra,
  });
  const invoice = (extra: Record<string, unknown> = {}) => ({
    targetType: "CARD_INVOICE",
    creditCardId: cardId,
    invoiceCycle: "2026-11",
    ...extra,
  });
  const dueItem = async (targetKey: string) => {
    const res = await api()
      .get("/api/v1/dashboard/summary")
      .set(authA())
      .expect(200);
    return (
      res.body.dueItems as Array<{
        targetKey: string;
        status: string;
        paidOn: string | null;
      }>
    ).find((i) => i.targetKey === targetKey);
  };

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
  ): Promise<string> {
    const res = await api()
      .post("/api/v1/recurring-bills")
      .set(authA())
      .send({
        amountMinor: 10000,
        currency: "BRL",
        dayOfMonth,
        description,
        startDate: "2026-11-01",
      })
      .expect(201);
    return res.body.id as string;
  }

  async function billTxnId(billId: string): Promise<string> {
    const row = await prisma.transaction.findFirstOrThrow({
      where: { recurringBillId: billId, periodKey: "2026-11" },
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
      .overrideProvider(NOTIFICATION_PROVIDER)
      .useValue(provider)
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
    evaluation = app.get(ReminderEvaluationService);

    tokenA = await register("pay-a@example.com");
    tokenB = await register("pay-b@example.com");
    await api()
      .put("/api/v1/reminders/settings")
      .set(authA())
      .send({ phoneE164: "+5511999990001", enabled: true })
      .expect(200);

    const condoBill = await createBill(10, "Condo"); // due 2026-11-10 (overdue)
    const internetBill = await createBill(25, "Internet"); // due 2026-11-25
    await app.get(GenerationService).generateForPeriod("2026-11");
    condoTxnId = await billTxnId(condoBill);
    internetTxnId = await billTxnId(internetBill);

    const card = await api()
      .post("/api/v1/credit-cards")
      .set(authA())
      .send({ label: "Visa Gold", closingDay: 10, dueDay: 20 })
      .expect(201);
    cardId = card.body.id as string;
    await api()
      .post(`/api/v1/credit-cards/${cardId}/purchases`)
      .set(authA())
      .send({
        idempotencyKey: "pay-p1",
        purchaseDate: "2026-11-05",
        amountMinor: 12550,
        currency: "BRL",
        description: "Groceries",
        installments: 1,
      })
      .expect(201);

    const manual = await api()
      .post("/api/v1/expenses")
      .set(authA())
      .send({
        amountMinor: 5000,
        currency: "BRL",
        expenseDate: "2026-11-03",
        description: "Pharmacy",
      })
      .expect(201);
    manualId = manual.body.id as string;
    await api()
      .post("/api/v1/imports")
      .set(authA())
      .attach(
        "file",
        Buffer.from("date,amount,description\n2026-11-04,10.00,coffee", "utf8"),
        "statement.csv",
      )
      .expect(201);
    importedId = (
      await prisma.transaction.findFirstOrThrow({
        where: { source: "IMPORTED" },
      })
    ).id;
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

  it("marks, re-marks, unmarks and re-unmarks without touching the ledger", async () => {
    const ledgerBefore = await prisma.transaction.count();

    const marked = await pay(
      authA(),
      condo({ paid: true, paidOn: "2026-11-09" }),
    ).expect(200);
    expect(marked.body).toEqual({
      targetType: "RECURRING_TRANSACTION",
      targetKey: `txn:${condoTxnId}`,
      paid: true,
      paidOn: "2026-11-09",
      recordedAt: NOW.toISOString(),
    });

    // Re-mark keeps the original record and date.
    const again = await pay(
      authA(),
      condo({ paid: true, paidOn: "2026-11-15" }),
    ).expect(200);
    expect(again.body.paidOn).toBe("2026-11-09");

    expect(await dueItem(`txn:${condoTxnId}`)).toMatchObject({
      status: "PAID",
      paidOn: "2026-11-09",
    });

    const unmarked = await pay(authA(), condo({ paid: false })).expect(200);
    expect(unmarked.body).toMatchObject({ paid: false, paidOn: null });
    await pay(authA(), condo({ paid: false })).expect(200);

    expect(await dueItem(`txn:${condoTxnId}`)).toMatchObject({
      status: "OVERDUE",
      paidOn: null,
    });
    expect(await prisma.transaction.count()).toBe(ledgerBefore);
    expect(
      await prisma.paymentMarker.count({
        where: { targetKey: `txn:${condoTxnId}` },
      }),
    ).toBe(0);
  });

  it("defaults the payment date to today and rejects a future one", async () => {
    const today = await pay(authA(), condo({ paid: true })).expect(200);
    expect(today.body.paidOn).toBe("2026-11-21");
    await pay(authA(), condo({ paid: false })).expect(200);

    const markersBefore = await prisma.paymentMarker.count();
    const future = await pay(
      authA(),
      condo({ paid: true, paidOn: "2026-11-22" }),
    ).expect(400);
    expect(future.body.error.code).toBe("VALIDATION_ERROR");
    await pay(authA(), condo({ paid: true, paidOn: "2026-02-30" })).expect(400);
    await pay(authA(), condo({ paid: false, paidOn: "2026-11-09" })).expect(
      400,
    );
    expect(await prisma.paymentMarker.count()).toBe(markersBefore);
  });

  it("is not-found for other users' items and for non-payable rows", async () => {
    const res = await pay(authB(), condo({ paid: true })).expect(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    await pay(authA(), {
      targetType: "RECURRING_TRANSACTION",
      transactionId: manualId,
      paid: true,
    }).expect(404);
    await pay(authA(), {
      targetType: "RECURRING_TRANSACTION",
      transactionId: importedId,
      paid: true,
    }).expect(404);
    await pay(authA(), invoice({ invoiceCycle: "2026-05", paid: true })).expect(
      404,
    );
    await pay(authB(), invoice({ paid: true })).expect(404);
    await api()
      .put("/api/v1/bill-payments")
      .send(condo({ paid: true }))
      .expect(401);
    expect(
      await prisma.paymentMarker.count({
        where: { targetKey: `txn:${condoTxnId}` },
      }),
    ).toBe(0);
  });

  it("keeps exactly one record under two simultaneous marks", async () => {
    const [first, second] = await Promise.all([
      pay(authA(), invoice({ paid: true, paidOn: "2026-11-18" })),
      pay(authA(), invoice({ paid: true, paidOn: "2026-11-19" })),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.paidOn).toBe(second.body.paidOn);
    expect(
      await prisma.paymentMarker.count({
        where: { targetKey: `card:${cardId}:2026-11` },
      }),
    ).toBe(1);
  });

  it("reports the invoice's paid state on the invoice endpoint", async () => {
    const paid = await api()
      .get(`/api/v1/credit-cards/${cardId}/invoices/2026-11`)
      .set(authA())
      .expect(200);
    expect(paid.body).toMatchObject({ paid: true });
    expect(["2026-11-18", "2026-11-19"]).toContain(paid.body.paidOn);

    await pay(authA(), invoice({ paid: false })).expect(200);
    const unpaid = await api()
      .get(`/api/v1/credit-cards/${cardId}/invoices/2026-11`)
      .set(authA())
      .expect(200);
    expect(unpaid.body).toMatchObject({ paid: false, paidOn: null });
  });

  it("sends no reminder for an item paid here, and fires once it is unmarked", async () => {
    await pay(authA(), {
      targetType: "RECURRING_TRANSACTION",
      transactionId: internetTxnId,
      paid: true,
    }).expect(200);

    await evaluation.evaluate("2026-11-22"); // D-3 for 2026-11-25
    expect(provider.sends.filter((s) => s.body.includes("Internet"))).toEqual(
      [],
    );

    await pay(authA(), {
      targetType: "RECURRING_TRANSACTION",
      transactionId: internetTxnId,
      paid: false,
    }).expect(200);

    await evaluation.evaluate("2026-11-22");
    expect(
      provider.sends.filter((s) => s.body.includes("Internet")),
    ).toHaveLength(1);
  });

  it("keeps PUT /reminders/paid behaving as before, on the same records", async () => {
    const res = await api()
      .put("/api/v1/reminders/paid")
      .set(authA())
      .send({
        targetType: "RECURRING_TRANSACTION",
        transactionId: condoTxnId,
        paid: true,
      })
      .expect(200);
    expect(res.body).toEqual({
      targetType: "RECURRING_TRANSACTION",
      targetKey: `txn:${condoTxnId}`,
      paid: true,
      paidAt: NOW.toISOString(),
    });

    expect(await dueItem(`txn:${condoTxnId}`)).toMatchObject({
      status: "PAID",
      paidOn: "2026-11-21",
    });

    await api()
      .put("/api/v1/reminders/paid")
      .set(authB())
      .send({
        targetType: "RECURRING_TRANSACTION",
        transactionId: condoTxnId,
        paid: true,
      })
      .expect(404);
  });

  it("uses the business date late on a São Paulo evening (app-timezone)", async () => {
    // 22:30 on Nov 21 in São Paulo is already Nov 22 in UTC.
    clock.instant = new Date("2026-11-22T01:30:00.000Z");
    try {
      await pay(authA(), condo({ paid: false })).expect(200);
      const marked = await pay(authA(), condo({ paid: true })).expect(200);
      expect(marked.body.paidOn).toBe("2026-11-21");
      expect(marked.body.recordedAt).toBe("2026-11-22T01:30:00.000Z");
      await pay(authA(), condo({ paid: false })).expect(200);

      await pay(authA(), condo({ paid: true, paidOn: "2026-11-22" })).expect(
        400,
      );
    } finally {
      clock.instant = NOW;
    }
  });
});
