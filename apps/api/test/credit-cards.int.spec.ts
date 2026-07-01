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
import { CardLedgerWriter } from "../src/cards/card-ledger-writer";
import { AllExceptionsFilter } from "../src/common/all-exceptions.filter";
import { requestIdMiddleware } from "../src/common/request-id";
import { PrismaService } from "../src/prisma/prisma.service";

const PW = "valid-password-123";

describe("credit-cards integration (real PostgreSQL)", () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;
  let writer: CardLedgerWriter;
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

  function createCard(
    headers: Record<string, string>,
    body: Record<string, unknown> = {},
  ): request.Test {
    return api()
      .post("/api/v1/credit-cards")
      .set(headers)
      .send({ label: "Visa", closingDay: 10, dueDay: 20, ...body });
  }

  function purchase(
    headers: Record<string, string>,
    cardId: string,
    body: Record<string, unknown>,
  ): request.Test {
    return api()
      .post(`/api/v1/credit-cards/${cardId}/purchases`)
      .set(headers)
      .send(body);
  }

  const basePurchase = (overrides: Record<string, unknown> = {}) => ({
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    purchaseDate: "2026-03-05",
    amountMinor: 10000,
    currency: "BRL",
    description: "TV",
    installments: 1,
    ...overrides,
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
    writer = app.get(CardLedgerWriter);

    tokenA = await token("cc-owner-a@example.com");
    tokenB = await token("cc-other-b@example.com");
    userAId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: "cc-owner-a@example.com" },
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

  // --- Card CRUD + isolation ---

  it("creates a card and validates the body", async () => {
    const res = await createCard(authA(), { creditLimitMinor: 500000 }).expect(
      201,
    );
    expect(res.body).toMatchObject({
      label: "Visa",
      closingDay: 10,
      dueDay: 20,
      creditLimitMinor: 500000,
      isActive: true,
    });
    await createCard(authA(), { dueDay: 32 }).expect(400);
    await createCard(authA(), { closingDay: 0 }).expect(400);
    await createCard(authA(), { creditLimitMinor: -1 }).expect(400);
    await api()
      .get("/api/v1/credit-cards?active=maybe")
      .set(authA())
      .expect(400);
    await api()
      .get("/api/v1/credit-cards?pageSize=101")
      .set(authA())
      .expect(400);
    await api().get("/api/v1/credit-cards/not-a-uuid").set(authA()).expect(400);
  });

  it("requires authentication", async () => {
    await api().get("/api/v1/credit-cards").expect(401);
  });

  it("rejects an empty PATCH body with 400", async () => {
    const c = await createCard(authA()).expect(201);
    await api()
      .patch(`/api/v1/credit-cards/${c.body.id}`)
      .set(authA())
      .send({})
      .expect(400);
  });

  it("isolates cards per user (cross-user → 404)", async () => {
    const c = await createCard(authA()).expect(201);
    const id = c.body.id;
    await api().get(`/api/v1/credit-cards/${id}`).set(authB()).expect(404);
    await api()
      .patch(`/api/v1/credit-cards/${id}`)
      .set(authB())
      .send({ label: "x" })
      .expect(404);
    await api().delete(`/api/v1/credit-cards/${id}`).set(authB()).expect(404);
    await api().get(`/api/v1/credit-cards/${id}`).set(authA()).expect(200);
  });

  it("DELETE deactivates (204) and preserves generated transactions", async () => {
    const c = await createCard(authA()).expect(201);
    await purchase(
      authA(),
      c.body.id,
      basePurchase({ installments: 2 }),
    ).expect(201);
    await api()
      .delete(`/api/v1/credit-cards/${c.body.id}`)
      .set(authA())
      .expect(204);
    const got = await api()
      .get(`/api/v1/credit-cards/${c.body.id}`)
      .set(authA())
      .expect(200);
    expect(got.body.isActive).toBe(false);
    expect(
      await prisma.transaction.count({ where: { creditCardId: c.body.id } }),
    ).toBe(2);
  });

  // --- Purchase: assignment (R4) + installments (R5) ---

  it("records a single-payment purchase on the assigned cycle", async () => {
    const c = await createCard(authA()).expect(201);
    const res = await purchase(
      authA(),
      c.body.id,
      basePurchase({ purchaseDate: "2026-03-10", installments: 1 }),
    ).expect(201);
    expect(res.body.transactions).toHaveLength(1);
    expect(res.body.transactions[0]).toMatchObject({
      invoiceCycle: "2026-03", // on closing day (inclusive)
      dueDate: "2026-03-20",
      installmentSeq: 1,
      installmentTotal: 1,
      amountMinor: 10000,
    });
  });

  it("splits installments across consecutive cycles summing to the total", async () => {
    const c = await createCard(authA()).expect(201);
    const res = await purchase(
      authA(),
      c.body.id,
      basePurchase({
        purchaseDate: "2026-03-05",
        amountMinor: 10000,
        installments: 3,
      }),
    ).expect(201);
    const tx = res.body.transactions as Array<{
      invoiceCycle: string;
      amountMinor: number;
      installmentSeq: number;
      installmentTotal: number;
    }>;
    expect(tx.map((t) => t.invoiceCycle)).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
    ]);
    expect(tx.map((t) => t.amountMinor)).toEqual([3334, 3333, 3333]);
    expect(tx.reduce((s, t) => s + t.amountMinor, 0)).toBe(10000);
    expect(tx.every((t) => t.installmentTotal === 3)).toBe(true);
    // owner + classification
    const rows = await prisma.transaction.findMany({
      where: { cardPurchaseId: res.body.id },
    });
    expect(rows.every((r) => r.userId === userAId && r.source === "CARD")).toBe(
      true,
    );
  });

  it("rolls a purchase after the closing day into the next cycle (+ year roll)", async () => {
    const c = await createCard(authA()).expect(201);
    const after = await purchase(
      authA(),
      c.body.id,
      basePurchase({ purchaseDate: "2026-03-11", installments: 1 }),
    ).expect(201);
    expect(after.body.transactions[0].invoiceCycle).toBe("2026-04");
    const dec = await purchase(
      authA(),
      c.body.id,
      basePurchase({ purchaseDate: "2026-12-15", installments: 1 }),
    ).expect(201);
    expect(dec.body.transactions[0].invoiceCycle).toBe("2027-01");
  });

  it("rejects bad installment counts and inactive cards", async () => {
    const c = await createCard(authA()).expect(201);
    await purchase(
      authA(),
      c.body.id,
      basePurchase({ installments: 25 }),
    ).expect(400);
    await purchase(
      authA(),
      c.body.id,
      basePurchase({ installments: 0 }),
    ).expect(400);
    await api()
      .delete(`/api/v1/credit-cards/${c.body.id}`)
      .set(authA())
      .expect(204);
    await purchase(authA(), c.body.id, basePurchase()).expect(400); // inactive
  });

  // --- Idempotency (R13) ---

  it("is idempotent: same key + payload returns the existing purchase", async () => {
    const c = await createCard(authA()).expect(201);
    const body = basePurchase({
      idempotencyKey: "fixed-key-1",
      installments: 2,
    });
    const first = await purchase(authA(), c.body.id, body).expect(201);
    const second = await purchase(authA(), c.body.id, body).expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect(
      await prisma.cardPurchase.count({
        where: { userId: userAId, idempotencyKey: "fixed-key-1" },
      }),
    ).toBe(1);
    expect(
      await prisma.transaction.count({
        where: { cardPurchaseId: first.body.id },
      }),
    ).toBe(2);
  });

  it("is concurrency-safe: parallel same-key requests converge to one plan", async () => {
    const c = await createCard(authA()).expect(201);
    const body = basePurchase({
      idempotencyKey: "race-key-1",
      installments: 2,
    });
    await Promise.all([
      purchase(authA(), c.body.id, body),
      purchase(authA(), c.body.id, body),
    ]);
    expect(
      await prisma.cardPurchase.count({
        where: { userId: userAId, idempotencyKey: "race-key-1" },
      }),
    ).toBe(1);
  });

  it("returns 409 when the same key is reused with a divergent payload", async () => {
    const c = await createCard(authA()).expect(201);
    await purchase(
      authA(),
      c.body.id,
      basePurchase({ idempotencyKey: "dup-key-1", amountMinor: 10000 }),
    ).expect(201);
    await purchase(
      authA(),
      c.body.id,
      basePurchase({ idempotencyKey: "dup-key-1", amountMinor: 99999 }),
    ).expect(409);
  });

  // --- Atomicity (R7) — test-safe: force a DB-rejected row inside the tx ---

  it("atomic creation: a mid-write failure persists zero rows", async () => {
    const c = await createCard(authA()).expect(201);
    // A plan whose row violates the CHECK (installmentSeq > installmentTotal)
    // makes the DB reject the second insert; the whole $transaction must roll
    // back, leaving no CardPurchase and no Transaction. No production hooks.
    await expect(
      writer.create({
        userId: userAId,
        creditCardId: c.body.id,
        idempotencyKey: "atomic-key-1",
        requestHash: "hash",
        purchaseDate: new Date("2026-03-05T00:00:00.000Z"),
        amountMinor: 10000n,
        currency: "BRL",
        description: "TV",
        categoryLabel: null,
        installments: 2,
        startCycle: "2026-03",
        rows: [
          {
            invoiceCycle: "2026-03",
            installmentSeq: 1,
            installmentTotal: 2,
            amountMinor: 5000n,
            transactionDate: new Date("2026-03-20T00:00:00.000Z"),
          },
          {
            invoiceCycle: "2026-04",
            installmentSeq: 5, // > installmentTotal -> CHECK violation
            installmentTotal: 2,
            amountMinor: 5000n,
            transactionDate: new Date("2026-04-20T00:00:00.000Z"),
          },
        ],
      }),
    ).rejects.toBeDefined();

    expect(
      await prisma.cardPurchase.count({
        where: { userId: userAId, idempotencyKey: "atomic-key-1" },
      }),
    ).toBe(0);
    expect(
      await prisma.transaction.count({ where: { creditCardId: c.body.id } }),
    ).toBe(0);
  });

  // --- Invoice view (R8) ---

  it("returns a derived invoice with exact total and due date", async () => {
    const c = await createCard(authA()).expect(201);
    await purchase(
      authA(),
      c.body.id,
      basePurchase({
        purchaseDate: "2026-05-01",
        amountMinor: 10000,
        installments: 3,
      }),
    ).expect(201);
    const inv = await api()
      .get(`/api/v1/credit-cards/${c.body.id}/invoices/2026-05`)
      .set(authA())
      .expect(200);
    expect(inv.body.totalMinor).toBe(3334); // first installment for cycle 2026-05
    expect(inv.body.dueDate).toBe("2026-05-20");
    expect(inv.body.transactions).toHaveLength(1);
  });

  it("returns a zero-total invoice for an empty cycle and 400 for a bad cycle", async () => {
    const c = await createCard(authA()).expect(201);
    const empty = await api()
      .get(`/api/v1/credit-cards/${c.body.id}/invoices/2030-01`)
      .set(authA())
      .expect(200);
    expect(empty.body.totalMinor).toBe(0);
    expect(empty.body.transactions).toEqual([]);
    await api()
      .get(`/api/v1/credit-cards/${c.body.id}/invoices/2030-13`)
      .set(authA())
      .expect(400);
    await api()
      .get(`/api/v1/credit-cards/${c.body.id}/invoices/nope`)
      .set(authA())
      .expect(400);
  });

  it("invoice: cross-user/unknown card → 404; deactivated card still returns", async () => {
    const c = await createCard(authA()).expect(201);
    await purchase(
      authA(),
      c.body.id,
      basePurchase({ purchaseDate: "2026-06-01" }),
    ).expect(201);
    await api()
      .get(`/api/v1/credit-cards/${c.body.id}/invoices/2026-06`)
      .set(authB())
      .expect(404);
    await api()
      .delete(`/api/v1/credit-cards/${c.body.id}`)
      .set(authA())
      .expect(204);
    const inv = await api()
      .get(`/api/v1/credit-cards/${c.body.id}/invoices/2026-06`)
      .set(authA())
      .expect(200);
    expect(inv.body.totalMinor).toBe(10000);
  });

  it("round-trips the installment date unchanged under a non-UTC timezone", async () => {
    expect(process.env.TZ).toBe("America/Sao_Paulo");
    const c = await createCard(authA()).expect(201);
    const res = await purchase(
      authA(),
      c.body.id,
      basePurchase({ purchaseDate: "2026-01-31", installments: 1 }),
    ).expect(201);
    // closing 10 / due 20; 2026-01-31 is after closing -> cycle 2026-02, due 2026-02-20
    expect(res.body.transactions[0].dueDate).toBe("2026-02-20");
  });

  // --- Source protection (R9) + CHECK (both/all invalid states) ---

  it("manual expense endpoints cannot see or mutate a CARD row", async () => {
    const c = await createCard(authA()).expect(201);
    const res = await purchase(authA(), c.body.id, basePurchase()).expect(201);
    const cardTxId = res.body.transactions[0].id;

    const list = await api()
      .get("/api/v1/expenses?pageSize=100")
      .set(authA())
      .expect(200);
    const ids = (list.body.data as Array<{ id: string }>).map((e) => e.id);
    expect(ids).not.toContain(cardTxId);

    await api().get(`/api/v1/expenses/${cardTxId}`).set(authA()).expect(404);
    await api()
      .patch(`/api/v1/expenses/${cardTxId}`)
      .set(authA())
      .send({ amountMinor: 1 })
      .expect(404);
    await api().delete(`/api/v1/expenses/${cardTxId}`).set(authA()).expect(404);

    const still = await prisma.transaction.findUniqueOrThrow({
      where: { id: cardTxId },
    });
    expect(still.source).toBe("CARD");
  });

  it("CHECK rejects invalid link states for every source", async () => {
    const c = await createCard(authA()).expect(201);
    // A real purchase gives us a valid cardPurchaseId so the installment-invariant
    // case is rejected by the CHECK (not by a foreign-key violation).
    const p = await purchase(authA(), c.body.id, basePurchase()).expect(201);
    const cardPurchaseId = (
      await prisma.transaction.findFirstOrThrow({
        where: { cardPurchaseId: { not: null }, creditCardId: c.body.id },
      })
    ).cardPurchaseId as string;
    const base = `INSERT INTO transactions
      (id,"userId",type,source,"amountMinor",currency,"transactionDate",description,"createdAt","updatedAt"`;

    // MANUAL with card columns populated
    await expect(
      prisma.$executeRawUnsafe(
        `${base},"creditCardId") VALUES (gen_random_uuid(),$1,'EXPENSE','MANUAL',100,'BRL','2099-01-01','bad',now(),now(),$2)`,
        userAId,
        c.body.id,
      ),
    ).rejects.toBeDefined();

    // RECURRING without its link columns
    await expect(
      prisma.$executeRawUnsafe(
        `${base}) VALUES (gen_random_uuid(),$1,'EXPENSE','RECURRING',100,'BRL','2099-01-01','bad',now(),now())`,
        userAId,
      ),
    ).rejects.toBeDefined();

    // CARD without its link columns
    await expect(
      prisma.$executeRawUnsafe(
        `${base}) VALUES (gen_random_uuid(),$1,'EXPENSE','CARD',100,'BRL','2099-01-01','bad',now(),now())`,
        userAId,
      ),
    ).rejects.toBeDefined();

    // CARD with installmentSeq > installmentTotal (valid FKs -> CHECK is the reason)
    await expect(
      prisma.$executeRawUnsafe(
        `${base},"creditCardId","cardPurchaseId","invoiceCycle","installmentSeq","installmentTotal")
         VALUES (gen_random_uuid(),$1,'EXPENSE','CARD',100,'BRL','2099-01-01','bad',now(),now(),$2,$3,'2099-01',5,2)`,
        userAId,
        c.body.id,
        cardPurchaseId,
      ),
    ).rejects.toBeDefined();
    expect(p.body.id).toBeDefined();
  });
});
