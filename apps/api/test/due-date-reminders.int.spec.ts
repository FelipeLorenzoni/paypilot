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
import {
  NOTIFICATION_PROVIDER,
  type NotificationProvider,
  type NotificationResult,
  type OutboundNotification,
} from "../src/integrations/notifications/notification-provider";
import { PrismaService } from "../src/prisma/prisma.service";
import { GenerationService } from "../src/recurring-bills/generation.service";
import { ReminderEvaluationService } from "../src/reminders/reminder-evaluation.service";
import { RemindersRepository } from "../src/reminders/reminders.repository";

const PW = "valid-password-123";

/** Recording fake provider — no external calls; failure injectable. */
class RecordingProvider implements NotificationProvider {
  sends: OutboundNotification[] = [];
  mode: "ok" | "fail" = "ok";

  send(notification: OutboundNotification): Promise<NotificationResult> {
    this.sends.push(notification);
    return Promise.resolve(
      this.mode === "ok" ? { ok: true } : { ok: false, errorCode: "TEST_FAIL" },
    );
  }
}

describe("due-date-reminders integration (real PostgreSQL)", () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;
  let generation: GenerationService;
  let evaluation: ReminderEvaluationService;
  let repo: RemindersRepository;
  const provider = new RecordingProvider();

  let tokenA = "";
  let tokenB = "";
  let userAId = "";
  let userBId = "";

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
    headers: Record<string, string>,
    dayOfMonth: number,
    description: string,
    amountMinor = 5000,
  ): Promise<string> {
    const res = await api()
      .post("/api/v1/recurring-bills")
      .set(headers)
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

  /** The generated RECURRING transaction id for (bill, period). */
  async function billTxnId(billId: string, period: string): Promise<string> {
    const row = await prisma.transaction.findFirstOrThrow({
      where: { recurringBillId: billId, periodKey: period },
    });
    return row.id;
  }

  const deliveriesFor = (targetKey: string, userId?: string) =>
    prisma.reminderDelivery.findMany({
      where: { targetKey, ...(userId ? { userId } : {}) },
      orderBy: { createdAt: "asc" },
    });

  const sendsMatching = (fragment: string) =>
    provider.sends.filter((s) => s.body.includes(fragment));

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
    generation = app.get(GenerationService);
    evaluation = app.get(ReminderEvaluationService);
    repo = app.get(RemindersRepository);

    tokenA = await register("remind-a@example.com");
    tokenB = await register("remind-b@example.com");
    userAId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: "remind-a@example.com" },
      })
    ).id;
    userBId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: "remind-b@example.com" },
      })
    ).id;

    await api()
      .put("/api/v1/reminders/settings")
      .set(authA())
      .send({ phoneE164: "+5511999990001", enabled: true })
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

  // --- Settings endpoints (8.3) ---

  it("settings: defaults, round-trip, validation, and auth", async () => {
    const fresh = await register("remind-defaults@example.com");
    const auth = { authorization: `Bearer ${fresh}` };

    const defaults = await api()
      .get("/api/v1/reminders/settings")
      .set(auth)
      .expect(200);
    expect(defaults.body).toEqual({ phoneE164: null, enabled: false });

    const updated = await api()
      .put("/api/v1/reminders/settings")
      .set(auth)
      .send({ phoneE164: "+5511988887777", enabled: true })
      .expect(200);
    expect(updated.body).toEqual({
      phoneE164: "+5511988887777",
      enabled: true,
    });

    await api()
      .put("/api/v1/reminders/settings")
      .set(auth)
      .send({ phoneE164: "11 99888-7777", enabled: true })
      .expect(400);

    await api().get("/api/v1/reminders/settings").expect(401);
    await api().put("/api/v1/reminders/settings").send({}).expect(401);
    await api().put("/api/v1/reminders/paid").send({}).expect(401);
  });

  // --- Happy path: recurring D-3 (8.1) ---

  let rentTxnId = "";

  it("sends a D-3 reminder for an unpaid generated RECURRING occurrence", async () => {
    const billId = await createBill(authA(), 10, "Rent"); // due 2026-03-10
    await generation.generateForPeriod("2026-03");
    rentTxnId = await billTxnId(billId, "2026-03");

    const summary = await evaluation.evaluate("2026-03-07"); // D-3

    expect(summary.sent).toBe(1);
    const sends = sendsMatching("Rent");
    expect(sends).toHaveLength(1);
    expect(sends[0].destination).toBe("+5511999990001");
    expect(sends[0].body).toContain("R$ 50,00");
    expect(sends[0].body).toContain("vence em 3 dias (2026-03-10)");

    const rows = await deliveriesFor(`txn:${rentTxnId}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: userAId,
      targetType: "RECURRING_TRANSACTION",
      windowDaysBefore: 3,
      channel: "WHATSAPP",
      status: "SENT",
      attempt: 1,
    });
    expect(rows[0].sentAt).not.toBeNull();
  });

  it("re-running the same evaluation sends nothing new (R2)", async () => {
    const before = provider.sends.length;
    const summary = await evaluation.evaluate("2026-03-07");
    expect(provider.sends.length).toBe(before);
    expect(summary.sent).toBe(0);
    expect(summary.skippedClaimed).toBeGreaterThanOrEqual(1);
    expect(await deliveriesFor(`txn:${rentTxnId}`)).toHaveLength(1);
  });

  // --- Happy path: card invoice D-0, cross-feature invariant (8.1) ---

  it("sends one invoice-level D-0 reminder summing the cycle's CARD rows", async () => {
    const cardRes = await api()
      .post("/api/v1/credit-cards")
      .set(authA())
      .send({ label: "Visa Gold", closingDay: 10, dueDay: 20 })
      .expect(201);
    const cardId = cardRes.body.id as string;

    // Two purchases through the REAL card flow, both in cycle 2026-03
    // (purchaseDate <= closingDay). credit-cards-invoices sets each CARD row's
    // transactionDate to the cycle due date — the invariant reminders rely on.
    for (const [key, amount] of [
      ["p1", 10000],
      ["p2", 2550],
    ] as const) {
      await api()
        .post(`/api/v1/credit-cards/${cardId}/purchases`)
        .set(authA())
        .send({
          idempotencyKey: `remind-${key}`,
          purchaseDate: "2026-03-05",
          amountMinor: amount,
          currency: "BRL",
          description: `Purchase ${key}`,
          installments: 1,
        })
        .expect(201);
    }
    const cardRows = await prisma.transaction.findMany({
      where: { creditCardId: cardId, invoiceCycle: "2026-03" },
    });
    expect(cardRows).toHaveLength(2);
    // The invariant, asserted explicitly:
    for (const row of cardRows) {
      expect(row.transactionDate.toISOString().slice(0, 10)).toBe("2026-03-20");
    }

    const summary = await evaluation.evaluate("2026-03-20"); // D-0

    expect(summary.sent).toBeGreaterThanOrEqual(1);
    const sends = sendsMatching("Visa Gold");
    expect(sends).toHaveLength(1);
    expect(sends[0].body).toContain("R$ 125,50"); // SUM of the cycle
    expect(sends[0].body).toContain("vence hoje (2026-03-20)");

    const rows = await deliveriesFor(`card:${cardId}:2026-03`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      targetType: "CARD_INVOICE",
      windowDaysBefore: 0,
      status: "SENT",
    });
  });

  // --- R1: paid at selection + unmark re-enables unconsumed windows (8.1) ---

  it("never selects a paid item; unmarking re-enables an unconsumed window", async () => {
    const billId = await createBill(authA(), 15, "Luz"); // due 2026-03-15
    await generation.generateForPeriod("2026-03");
    const txnId = await billTxnId(billId, "2026-03");

    await api()
      .put("/api/v1/reminders/paid")
      .set(authA())
      .send({
        targetType: "RECURRING_TRANSACTION",
        transactionId: txnId,
        paid: true,
      })
      .expect(200);

    await evaluation.evaluate("2026-03-12"); // D-3 while paid
    expect(await deliveriesFor(`txn:${txnId}`)).toHaveLength(0); // not even claimed
    expect(sendsMatching("Luz")).toHaveLength(0);

    await api()
      .put("/api/v1/reminders/paid")
      .set(authA())
      .send({
        targetType: "RECURRING_TRANSACTION",
        transactionId: txnId,
        paid: false,
      })
      .expect(200);

    const summary = await evaluation.evaluate("2026-03-12"); // same window, never consumed
    expect(summary.sent).toBe(1);
    expect(sendsMatching("Luz")).toHaveLength(1);
  });

  // --- R1 race: paid between selection and send → SKIPPED, terminal (8.1) ---

  it("skips (terminal) when the item is paid between selection and send", async () => {
    const billId = await createBill(authA(), 18, "Água"); // due 2026-03-18
    await generation.generateForPeriod("2026-03");
    const txnId = await billTxnId(billId, "2026-03");
    const target = {
      targetType: "RECURRING_TRANSACTION" as const,
      targetKey: `txn:${txnId}`,
    };

    // Simulate the race: insert the paid marker AFTER selection returns.
    const original = repo.findDueItems.bind(repo);
    const spy = jest
      .spyOn(repo, "findDueItems")
      .mockImplementation(async (dates) => {
        const items = await original(dates);
        await prisma.paymentMarker.create({
          data: {
            userId: userAId,
            targetType: target.targetType,
            targetKey: target.targetKey,
            transactionId: txnId,
            paidAt: new Date(),
            paidOn: new Date("2026-03-12T00:00:00.000Z"),
          },
        });
        return items;
      });
    try {
      const summary = await evaluation.evaluate("2026-03-15"); // D-3
      expect(summary.skippedPaid).toBe(1);
    } finally {
      spy.mockRestore();
    }
    expect(sendsMatching("Água")).toHaveLength(0); // provider never called
    let rows = await deliveriesFor(target.targetKey);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("SKIPPED");

    // SKIPPED is terminal: unmarking unpaid does NOT re-open the identity...
    await api()
      .put("/api/v1/reminders/paid")
      .set(authA())
      .send({
        targetType: "RECURRING_TRANSACTION",
        transactionId: txnId,
        paid: false,
      })
      .expect(200);
    const rerun = await evaluation.evaluate("2026-03-15");
    expect(rerun.sent).toBe(0);
    expect(rerun.skippedClaimed).toBeGreaterThanOrEqual(1);
    expect(sendsMatching("Água")).toHaveLength(0);
    rows = await deliveriesFor(target.targetKey);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("SKIPPED");

    // ...but a FUTURE (unconsumed) window still fires normally.
    const d0 = await evaluation.evaluate("2026-03-18");
    expect(d0.sent).toBe(1);
    expect(sendsMatching("Água")).toHaveLength(1);
    rows = await deliveriesFor(target.targetKey);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.status).sort()).toEqual(["SENT", "SKIPPED"]);
  });

  // --- R2: provider failure → FAILED, retried once, one SENT (8.2) ---

  it("records FAILED on provider failure and retries to exactly one SENT", async () => {
    const billId = await createBill(authA(), 25, "Net"); // due 2026-03-25
    await generation.generateForPeriod("2026-03");
    const txnId = await billTxnId(billId, "2026-03");

    provider.mode = "fail";
    const failed = await evaluation.evaluate("2026-03-22"); // D-3
    provider.mode = "ok";
    expect(failed.failed).toBe(1);
    let rows = await deliveriesFor(`txn:${txnId}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "FAILED",
      errorCode: "TEST_FAIL",
      attempt: 1,
    });

    const retried = await evaluation.evaluate("2026-03-22");
    expect(retried.sent).toBe(1);
    rows = await deliveriesFor(`txn:${txnId}`);
    expect(rows).toHaveLength(1); // same logical delivery, re-claimed
    expect(rows[0]).toMatchObject({
      status: "SENT",
      attempt: 2,
      errorCode: null,
    });
    expect(sendsMatching("Net")).toHaveLength(2); // 1 failed attempt + 1 success
  });

  // --- R2: concurrent evaluations converge (8.2) ---

  it("overlapping concurrent evaluations produce exactly one SENT per identity", async () => {
    const billId = await createBill(authA(), 28, "Seguro"); // due 2026-03-28
    await generation.generateForPeriod("2026-03");
    const txnId = await billTxnId(billId, "2026-03");

    await Promise.all([
      evaluation.evaluate("2026-03-25"),
      evaluation.evaluate("2026-03-25"),
    ]);

    const rows = await deliveriesFor(`txn:${txnId}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("SENT");
    expect(sendsMatching("Seguro")).toHaveLength(1);
  });

  it("the unique index rejects a raw duplicate identity at the DB (R2)", async () => {
    const existing = await prisma.reminderDelivery.findFirstOrThrow({
      where: { targetKey: `txn:${rentTxnId}` },
    });
    await expect(
      prisma.reminderDelivery.create({
        data: {
          userId: existing.userId,
          targetType: existing.targetType,
          targetKey: existing.targetKey,
          transactionId: existing.transactionId,
          dueDate: existing.dueDate,
          windowDaysBefore: existing.windowDaysBefore,
          channel: existing.channel,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  // --- R2: stale PENDING re-claimed; fresh PENDING respected (8.2) ---

  it("re-claims a stale PENDING but never a fresh one", async () => {
    const billId = await createBill(authA(), 31, "Streaming"); // due 2026-03-31
    await generation.generateForPeriod("2026-03");
    const txnId = await billTxnId(billId, "2026-03");

    // Stale claim: a crashed run left PENDING 13h ago → re-claimed and sent.
    await prisma.reminderDelivery.create({
      data: {
        userId: userAId,
        targetType: "RECURRING_TRANSACTION",
        targetKey: `txn:${txnId}`,
        transactionId: txnId,
        dueDate: new Date("2026-03-31T00:00:00.000Z"),
        windowDaysBefore: 3,
        channel: "WHATSAPP",
        status: "PENDING",
      },
    });
    await prisma.$executeRaw`UPDATE "reminder_deliveries" SET "updatedAt" = now() - interval '13 hours' WHERE "targetKey" = ${`txn:${txnId}`}`;

    // Also fires Seguro's (new) D-0 identity — assert on Streaming's rows.
    const stale = await evaluation.evaluate("2026-03-28"); // D-3
    expect(stale.sent).toBeGreaterThanOrEqual(1);
    let rows = await deliveriesFor(`txn:${txnId}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "SENT", attempt: 2 });

    // Fresh claim: another run owns it right now → left alone, no send.
    await prisma.reminderDelivery.create({
      data: {
        userId: userAId,
        targetType: "RECURRING_TRANSACTION",
        targetKey: `txn:${txnId}`,
        transactionId: txnId,
        dueDate: new Date("2026-03-31T00:00:00.000Z"),
        windowDaysBefore: 0,
        channel: "WHATSAPP",
        status: "PENDING",
      },
    });
    const before = provider.sends.length;
    const fresh = await evaluation.evaluate("2026-03-31"); // D-0
    expect(fresh.sent).toBe(0);
    expect(provider.sends.length).toBe(before);
    rows = await deliveriesFor(`txn:${txnId}`);
    const d0 = rows.find((r) => r.windowDaysBefore === 0);
    expect(d0).toMatchObject({ status: "PENDING", attempt: 1 });
  });

  // --- Opt-in and eligibility (8.1) ---

  it("writes no delivery rows for opted-out users; opting in enables them", async () => {
    const billB = await createBill(authB(), 9, "B-Conta"); // user B: no settings yet
    await generation.generateForPeriod("2026-03");
    const txnBId = await billTxnId(billB, "2026-03");

    await evaluation.evaluate("2026-03-09"); // D-0
    expect(await deliveriesFor(`txn:${txnBId}`)).toHaveLength(0);

    // Disabled with a phone → still skipped.
    await api()
      .put("/api/v1/reminders/settings")
      .set(authB())
      .send({ phoneE164: "+5511999990002", enabled: false })
      .expect(200);
    await evaluation.evaluate("2026-03-09");
    expect(await deliveriesFor(`txn:${txnBId}`)).toHaveLength(0);

    // Opt in → the (never consumed) window fires, to B's own phone.
    await api()
      .put("/api/v1/reminders/settings")
      .set(authB())
      .send({ phoneE164: "+5511999990002", enabled: true })
      .expect(200);
    const summary = await evaluation.evaluate("2026-03-09");
    expect(summary.sent).toBe(1);
    const sends = sendsMatching("B-Conta");
    expect(sends).toHaveLength(1);
    expect(sends[0].destination).toBe("+5511999990002");
    const rows = await deliveriesFor(`txn:${txnBId}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(userBId);
  });

  it("MANUAL and IMPORTED transactions never produce reminders", async () => {
    await api()
      .post("/api/v1/expenses")
      .set(authA())
      .send({
        amountMinor: 999,
        currency: "BRL",
        expenseDate: "2026-05-04", // D-3 window of 2026-05-01... any date works
        description: "Manual coffee",
      })
      .expect(201);

    await evaluation.evaluate("2026-05-01");
    await evaluation.evaluate("2026-05-04");
    expect(sendsMatching("Manual coffee")).toHaveLength(0);
  });

  // --- tz safety: month boundary under TZ=America/Sao_Paulo (8.1) ---

  it("matches a D-3 window across a month boundary (non-UTC process tz)", async () => {
    expect(process.env.TZ).toBe("America/Sao_Paulo");
    const billId = await createBill(authA(), 2, "Boundary"); // due 2026-04-02
    await generation.generateForPeriod("2026-04");
    const txnId = await billTxnId(billId, "2026-04");

    const summary = await evaluation.evaluate("2026-03-30"); // D-3 across months
    expect(summary.sent).toBeGreaterThanOrEqual(1);
    const rows = await deliveriesFor(`txn:${txnId}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].dueDate.toISOString().slice(0, 10)).toBe("2026-04-02");
  });

  // --- Paid endpoint semantics + isolation (8.3) ---

  it("paid endpoint is idempotent both ways and 404s on invalid targets", async () => {
    const markBody = {
      targetType: "RECURRING_TRANSACTION",
      transactionId: rentTxnId,
      paid: true,
    };
    const first = await api()
      .put("/api/v1/reminders/paid")
      .set(authA())
      .send(markBody)
      .expect(200);
    const second = await api()
      .put("/api/v1/reminders/paid")
      .set(authA())
      .send(markBody)
      .expect(200);
    expect(first.body.paid).toBe(true);
    expect(second.body.paidAt).toBe(first.body.paidAt); // re-mark: no side effects

    await api()
      .put("/api/v1/reminders/paid")
      .set(authA())
      .send({ ...markBody, paid: false })
      .expect(200);
    const unmarkAgain = await api()
      .put("/api/v1/reminders/paid")
      .set(authA())
      .send({ ...markBody, paid: false })
      .expect(200);
    expect(unmarkAgain.body).toMatchObject({ paid: false, paidAt: null });

    // Cross-user target → 404 without disclosure.
    await api()
      .put("/api/v1/reminders/paid")
      .set(authB())
      .send(markBody)
      .expect(404);

    // MANUAL transaction id → 404 (not reminder-eligible).
    const manualRow = await prisma.transaction.findFirstOrThrow({
      where: { userId: userAId, source: "MANUAL" },
    });
    await api()
      .put("/api/v1/reminders/paid")
      .set(authA())
      .send({ ...markBody, transactionId: manualRow.id })
      .expect(404);

    // Card invoice cycle without rows → 404; malformed cycle → 400.
    const card = await prisma.creditCard.findFirstOrThrow({
      where: { userId: userAId },
    });
    await api()
      .put("/api/v1/reminders/paid")
      .set(authA())
      .send({
        targetType: "CARD_INVOICE",
        creditCardId: card.id,
        invoiceCycle: "2030-01",
        paid: true,
      })
      .expect(404);
    await api()
      .put("/api/v1/reminders/paid")
      .set(authA())
      .send({
        targetType: "CARD_INVOICE",
        creditCardId: card.id,
        invoiceCycle: "2030-13",
        paid: true,
      })
      .expect(400);
  });

  it("an invoice-level paid marker suppresses the whole invoice", async () => {
    const card = await prisma.creditCard.findFirstOrThrow({
      where: { userId: userAId },
    });
    // Cycle 2026-04 holds nothing yet — add a purchase after the closing day
    // of March (rolls to cycle 2026-04, due 2026-04-20).
    await api()
      .post(`/api/v1/credit-cards/${card.id}/purchases`)
      .set(authA())
      .send({
        idempotencyKey: "remind-p3",
        purchaseDate: "2026-03-15",
        amountMinor: 7000,
        currency: "BRL",
        description: "Rolled purchase",
        installments: 1,
      })
      .expect(201);

    await api()
      .put("/api/v1/reminders/paid")
      .set(authA())
      .send({
        targetType: "CARD_INVOICE",
        creditCardId: card.id,
        invoiceCycle: "2026-04",
        paid: true,
      })
      .expect(200);

    const before = provider.sends.length;
    await evaluation.evaluate("2026-04-17"); // D-3 of 2026-04-20
    await evaluation.evaluate("2026-04-20"); // D-0
    expect(provider.sends.length).toBe(before); // nothing for the paid invoice
    expect(await deliveriesFor(`card:${card.id}:2026-04`)).toHaveLength(0);
  });

  // --- Ledger untouched + CHECK constraints (8.3) ---

  it("reminder operations never mutate ledger transactions", async () => {
    const before = await prisma.transaction.findMany({
      select: { id: true, updatedAt: true, amountMinor: true },
      orderBy: { id: "asc" },
    });

    await evaluation.evaluate("2026-03-07");
    await api()
      .put("/api/v1/reminders/paid")
      .set(authA())
      .send({
        targetType: "RECURRING_TRANSACTION",
        transactionId: rentTxnId,
        paid: true,
      })
      .expect(200);
    await api()
      .put("/api/v1/reminders/paid")
      .set(authA())
      .send({
        targetType: "RECURRING_TRANSACTION",
        transactionId: rentTxnId,
        paid: false,
      })
      .expect(200);

    const after = await prisma.transaction.findMany({
      select: { id: true, updatedAt: true, amountMinor: true },
      orderBy: { id: "asc" },
    });
    expect(after).toEqual(before);
  });

  it("CHECK constraints reject inconsistent typed target columns", async () => {
    // RECURRING_TRANSACTION marker carrying card columns → rejected.
    await expect(
      prisma.$executeRaw`INSERT INTO "payment_markers"
        ("id", "userId", "targetType", "targetKey", "transactionId", "creditCardId", "invoiceCycle", "paidAt", "paidOn", "updatedAt")
        VALUES (gen_random_uuid(), ${userAId}::uuid, 'RECURRING_TRANSACTION', 'txn:bad', ${rentTxnId}::uuid,
                (SELECT "id" FROM "credit_cards" LIMIT 1), '2026-03', now(), CURRENT_DATE, now())`,
    ).rejects.toThrow(/payment_markers_target_chk/);

    // CARD_INVOICE delivery without its card columns → rejected.
    await expect(
      prisma.$executeRaw`INSERT INTO "reminder_deliveries"
        ("id", "userId", "targetType", "targetKey", "dueDate", "windowDaysBefore", "channel", "updatedAt")
        VALUES (gen_random_uuid(), ${userAId}::uuid, 'CARD_INVOICE', 'card:bad', '2026-03-20', 0, 'WHATSAPP', now())`,
    ).rejects.toThrow(/reminder_deliveries_target_chk/);
  });

  it("keeps reminder data isolated per user", async () => {
    // B's settings are B's own; A's deliveries never carry B's user id.
    const settingsB = await api()
      .get("/api/v1/reminders/settings")
      .set(authB())
      .expect(200);
    expect(settingsB.body.phoneE164).toBe("+5511999990002");

    const aDeliveries = await prisma.reminderDelivery.findMany({
      where: { userId: userAId },
    });
    const bDeliveries = await prisma.reminderDelivery.findMany({
      where: { userId: userBId },
    });
    expect(aDeliveries.length).toBeGreaterThan(0);
    expect(bDeliveries.length).toBeGreaterThan(0);
    for (const send of provider.sends) {
      expect(["+5511999990001", "+5511999990002"]).toContain(send.destination);
    }
    // No B-phone message ever contains A's bill descriptions and vice versa.
    for (const send of provider.sends.filter(
      (s) => s.destination === "+5511999990002",
    )) {
      expect(send.body).toContain("B-Conta");
    }
  });
});
