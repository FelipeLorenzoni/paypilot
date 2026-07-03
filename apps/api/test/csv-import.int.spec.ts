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

const PW = "valid-password-123";

describe("csv-import integration (real PostgreSQL)", () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenA = "";
  let tokenB = "";
  let userAId = "";
  let userBId = "";

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

  const csv = (...lines: string[]): Buffer =>
    Buffer.from(lines.join("\n"), "utf8");

  function upload(headers: Record<string, string>, file: Buffer): request.Test {
    return api()
      .post("/api/v1/imports")
      .set(headers)
      .attach("file", file, "statement.csv");
  }

  const importedCountFor = (userId: string) =>
    prisma.transaction.count({ where: { userId, source: "IMPORTED" } });

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

    tokenA = await token("import-owner-a@example.com");
    tokenB = await token("import-other-b@example.com");
    userAId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: "import-owner-a@example.com" },
      })
    ).id;
    userBId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: "import-other-b@example.com" },
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

  // --- Happy path + provenance ---

  it("imports N valid rows as IMPORTED/EXPENSE and records a matching ImportRun", async () => {
    const res = await upload(
      authA(),
      csv(
        "date,amount,description,category",
        "2026-01-05,10.00,supermarket alpha,groceries",
        "2026-01-06,1234.56,rent alpha,",
        "2026-01-07,3.5,coffee alpha,leisure",
      ),
    ).expect(201);

    expect(res.body).toMatchObject({
      totalRows: 3,
      importedCount: 3,
      duplicateCount: 0,
      invalidCount: 0,
      invalidRows: [],
      duplicateRows: [],
    });
    expect(res.body.importRunId).toBeDefined();
    expect(res.body.totalRows).toBe(
      res.body.importedCount + res.body.duplicateCount + res.body.invalidCount,
    );

    const rows = await prisma.transaction.findMany({
      where: { userId: userAId, importRunId: res.body.importRunId },
    });
    expect(rows).toHaveLength(3);
    expect(
      rows.every(
        (r) =>
          r.source === "IMPORTED" &&
          r.type === "EXPENSE" &&
          r.dedupHash !== null &&
          r.currency === "BRL",
      ),
    ).toBe(true);
    expect(
      rows.map((r) => r.amountMinor).sort((a, b) => Number(a - b)),
    ).toEqual([350n, 1000n, 123456n]);

    const run = await prisma.importRun.findUniqueOrThrow({
      where: { id: res.body.importRunId },
    });
    expect(run).toMatchObject({
      userId: userAId,
      status: "COMPLETED",
      totalRows: 3,
      importedCount: 3,
      duplicateCount: 0,
      invalidCount: 0,
    });
  });

  it("GET /imports/:id returns the owner's run; cross-user/unknown → 404; malformed → 400", async () => {
    const res = await upload(
      authA(),
      csv("date,amount,description", "2026-01-08,20.00,provenance row"),
    ).expect(201);
    const runId = res.body.importRunId as string;

    const got = await api()
      .get(`/api/v1/imports/${runId}`)
      .set(authA())
      .expect(200);
    expect(got.body).toMatchObject({
      id: runId,
      status: "COMPLETED",
      totalRows: 1,
      importedCount: 1,
      duplicateCount: 0,
      invalidCount: 0,
    });
    expect(typeof got.body.createdAt).toBe("string");

    await api().get(`/api/v1/imports/${runId}`).set(authB()).expect(404);
    await api()
      .get("/api/v1/imports/00000000-0000-4000-8000-000000000000")
      .set(authA())
      .expect(404);
    await api().get("/api/v1/imports/not-a-uuid").set(authA()).expect(400);
  });

  it("requires authentication and a file", async () => {
    await upload(
      {},
      csv("date,amount,description", "2026-01-09,1.00,x"),
    ).expect(401);
    await api().get("/api/v1/imports/x").expect(401);
    await api().post("/api/v1/imports").set(authA()).expect(400); // no file
  });

  // --- Dedup / R6 ---

  it("re-importing the same file inserts zero new rows (DB truth)", async () => {
    const file = csv(
      "date,amount,description",
      "2026-02-01,50.00,reimport one",
      "2026-02-02,60.00,reimport two",
    );
    const first = await upload(authA(), file).expect(201);
    expect(first.body.importedCount).toBe(2);

    const before = await importedCountFor(userAId);
    const second = await upload(authA(), file).expect(201);
    expect(second.body).toMatchObject({
      totalRows: 2,
      importedCount: 0,
      duplicateCount: 2,
      invalidCount: 0,
    });
    expect(second.body.duplicateRows).toHaveLength(2);
    expect(await importedCountFor(userAId)).toBe(before);
  });

  it("skips an in-file duplicate (first wins) and reports its lineNumber", async () => {
    const res = await upload(
      authA(),
      csv(
        "date,amount,description",
        "2026-02-03,70.00,infile duplicate",
        "2026-02-03,70.00,infile duplicate",
      ),
    ).expect(201);
    expect(res.body).toMatchObject({
      totalRows: 2,
      importedCount: 1,
      duplicateCount: 1,
      invalidCount: 0,
    });
    expect(res.body.duplicateRows).toEqual([{ lineNumber: 3 }]);
  });

  it("treats normalization-equivalent descriptions as duplicates (R6)", async () => {
    await upload(
      authA(),
      csv("date,amount,description", "2026-02-04,80.00,Mercado  Pão"),
    ).expect(201);
    const res = await upload(
      authA(),
      csv("date,amount,description", "2026-02-04,80.00,  mercado pão  "),
    ).expect(201);
    expect(res.body.importedCount).toBe(0);
    expect(res.body.duplicateCount).toBe(1);
  });

  it("inserts a near-miss (one differing field is NOT a duplicate)", async () => {
    await upload(
      authA(),
      csv("date,amount,description", "2026-02-05,90.00,near miss base"),
    ).expect(201);
    const res = await upload(
      authA(),
      csv(
        "date,amount,description",
        "2026-02-06,90.00,near miss base", // different date
        "2026-02-05,90.01,near miss base", // different amount
        "2026-02-05,90.00,near miss other", // different description
      ),
    ).expect(201);
    expect(res.body.importedCount).toBe(3);
    expect(res.body.duplicateCount).toBe(0);
  });

  it("concurrent imports of the same file converge without duplicates", async () => {
    const file = csv(
      "date,amount,description",
      "2026-02-07,11.00,concurrent one",
      "2026-02-08,12.00,concurrent two",
      "2026-02-09,13.00,concurrent three",
    );
    const [r1, r2] = await Promise.all([
      upload(authA(), file),
      upload(authA(), file),
    ]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    // The DB partial unique index is the source of truth: exactly 3 rows total.
    expect(r1.body.importedCount + r2.body.importedCount).toBe(3);
    expect(r1.body.duplicateCount + r2.body.duplicateCount).toBe(3);
    const rows = await prisma.transaction.findMany({
      where: {
        userId: userAId,
        source: "IMPORTED",
        description: { startsWith: "concurrent" },
      },
    });
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.dedupHash)).size).toBe(3);
  });

  // --- Partial success / row validation ---

  it("imports valid rows and reports invalid ones with lineNumber + reasonCode", async () => {
    const res = await upload(
      authA(),
      csv(
        "date,amount,description,currency",
        "2026-03-01,10.00,partial valid one,BRL", // line 2 ok
        "2026-13-01,10.00,bad date,BRL", // line 3
        "2026-03-02,abc,bad amount,BRL", // line 4
        "2026-03-03,0,zero amount,BRL", // line 5
        "2026-03-04,-5.00,negative amount,BRL", // line 6
        "2026-03-05,10.00,dollar row,USD", // line 7
        "2026-03-06,10.00,,BRL", // line 8 missing description
        "2026-03-07,20.00,partial valid two,", // line 9 ok (currency defaults)
      ),
    ).expect(201);

    expect(res.body).toMatchObject({
      totalRows: 8,
      importedCount: 2,
      duplicateCount: 0,
      invalidCount: 6,
    });
    expect(res.body.invalidRows).toEqual([
      { lineNumber: 3, reasonCode: "INVALID_DATE" },
      { lineNumber: 4, reasonCode: "INVALID_AMOUNT_FORMAT" },
      { lineNumber: 5, reasonCode: "NON_POSITIVE_AMOUNT" },
      { lineNumber: 6, reasonCode: "NON_POSITIVE_AMOUNT" },
      { lineNumber: 7, reasonCode: "UNSUPPORTED_CURRENCY" },
      { lineNumber: 8, reasonCode: "MISSING_FIELD" },
    ]);
  });

  // --- Delimiters + BR amounts ---

  it("imports a semicolon-delimited file with unquoted BR amounts", async () => {
    const res = await upload(
      authA(),
      csv(
        "date;amount;description;category",
        "2026-04-01;1.234,56;semicolon br amount;mercado",
        "2026-04-02;10;semicolon integer;",
      ),
    ).expect(201);
    expect(res.body.importedCount).toBe(2);
    const row = await prisma.transaction.findFirstOrThrow({
      where: { userId: userAId, description: "semicolon br amount" },
    });
    expect(row.amountMinor).toBe(123456n);
    expect(row.categoryLabel).toBe("mercado");
  });

  it("imports a comma-delimited file with RFC-4180-quoted BR amounts", async () => {
    const res = await upload(
      authA(),
      csv(
        "date,amount,description",
        '2026-04-03,"1.234,56",comma quoted br amount',
      ),
    ).expect(201);
    expect(res.body.importedCount).toBe(1);
    const row = await prisma.transaction.findFirstOrThrow({
      where: { userId: userAId, description: "comma quoted br amount" },
    });
    expect(row.amountMinor).toBe(123456n);
  });

  it("rejects an unquoted comma-bearing amount under the comma delimiter (structural)", async () => {
    const runsBefore = await prisma.importRun.count();
    await upload(
      authA(),
      csv("date,amount,description", "2026-04-04,1.234,56,unquoted br amount"),
    ).expect(400);
    expect(await prisma.importRun.count()).toBe(runsBefore);
  });

  // --- Whole-file failures persist NOTHING ---

  it("rejects a bad header with 400 and persists nothing", async () => {
    const runsBefore = await prisma.importRun.count();
    const txBefore = await importedCountFor(userAId);
    await upload(
      authA(),
      csv("data,valor,descricao", "2026-05-01,10.00,wrong header"),
    ).expect(400);
    await upload(authA(), Buffer.alloc(0)).expect(400); // empty file
    expect(await prisma.importRun.count()).toBe(runsBefore);
    expect(await importedCountFor(userAId)).toBe(txBefore);
  });

  it("rejects an oversized file with 413 and persists nothing", async () => {
    const runsBefore = await prisma.importRun.count();
    const big = Buffer.alloc(1_048_577, "a"); // MAX_FILE_BYTES + 1
    await upload(authA(), big).expect(413);
    expect(await prisma.importRun.count()).toBe(runsBefore);
  });

  it("rejects a file with too many rows with 400 and persists nothing", async () => {
    const runsBefore = await prisma.importRun.count();
    const lines = ["date,amount,description"];
    for (let i = 0; i < 5001; i++) {
      lines.push(`2026-05-02,1.00,too many rows ${i}`);
    }
    await upload(authA(), csv(...lines)).expect(400);
    expect(await prisma.importRun.count()).toBe(runsBefore);
  });

  // --- Isolation ---

  it("dedup is per-user: user B imports rows identical to user A's", async () => {
    const file = csv(
      "date,amount,description",
      "2026-06-01,15.00,isolation shared row",
    );
    const a = await upload(authA(), file).expect(201);
    expect(a.body.importedCount).toBe(1);
    const b = await upload(authB(), file).expect(201);
    expect(b.body.importedCount).toBe(1);
    expect(
      await prisma.transaction.count({
        where: { userId: userBId, source: "IMPORTED" },
      }),
    ).toBeGreaterThan(0);
  });

  // --- tz safety ---

  it("round-trips an imported date unchanged under a non-UTC timezone", async () => {
    expect(process.env.TZ).toBe("America/Sao_Paulo");
    await upload(
      authA(),
      csv("date,amount,description", "2026-01-31,10.00,tz roundtrip row"),
    ).expect(201);
    const row = await prisma.transaction.findFirstOrThrow({
      where: { userId: userAId, description: "tz roundtrip row" },
    });
    expect(row.transactionDate.toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  // --- Source protection (8.2) ---

  it("manual expense endpoints cannot see or mutate an IMPORTED row", async () => {
    const res = await upload(
      authA(),
      csv("date,amount,description", "2026-07-01,25.00,source protection row"),
    ).expect(201);
    const tx = await prisma.transaction.findFirstOrThrow({
      where: { userId: userAId, description: "source protection row" },
    });

    const list = await api()
      .get("/api/v1/expenses?pageSize=100")
      .set(authA())
      .expect(200);
    const ids = (list.body.data as Array<{ id: string }>).map((e) => e.id);
    expect(ids).not.toContain(tx.id);

    await api().get(`/api/v1/expenses/${tx.id}`).set(authA()).expect(404);
    await api()
      .patch(`/api/v1/expenses/${tx.id}`)
      .set(authA())
      .send({ amountMinor: 1 })
      .expect(404);
    await api().delete(`/api/v1/expenses/${tx.id}`).set(authA()).expect(404);

    const still = await prisma.transaction.findUniqueOrThrow({
      where: { id: tx.id },
    });
    expect(still.source).toBe("IMPORTED");
    expect(res.body.importedCount).toBe(1);
  });

  // --- CHECK constraint (8.2) ---

  it("CHECK rejects invalid import link states and accepts the valid one", async () => {
    // A real run gives us a valid importRunId so rejections below are CHECK
    // violations, not foreign-key errors.
    const seeded = await upload(
      authA(),
      csv("date,amount,description", "2026-07-02,30.00,check seed row"),
    ).expect(201);
    const runId = seeded.body.importRunId as string;
    const hash = (suffix: string) =>
      suffix.repeat(64).slice(0, 64).toLowerCase();
    const base = `INSERT INTO transactions
      (id,"userId",type,source,"amountMinor",currency,"transactionDate",description,"createdAt","updatedAt"`;

    // IMPORTED without dedupHash/importRunId
    await expect(
      prisma.$executeRawUnsafe(
        `${base}) VALUES (gen_random_uuid(),$1,'EXPENSE','IMPORTED',100,'BRL','2099-01-01','bad',now(),now())`,
        userAId,
      ),
    ).rejects.toBeDefined();

    // IMPORTED with dedupHash but without importRunId
    await expect(
      prisma.$executeRawUnsafe(
        `${base},"dedupHash") VALUES (gen_random_uuid(),$1,'EXPENSE','IMPORTED',100,'BRL','2099-01-01','bad',now(),now(),$2)`,
        userAId,
        hash("a"),
      ),
    ).rejects.toBeDefined();

    // MANUAL with dedupHash populated
    await expect(
      prisma.$executeRawUnsafe(
        `${base},"dedupHash") VALUES (gen_random_uuid(),$1,'EXPENSE','MANUAL',100,'BRL','2099-01-01','bad',now(),now(),$2)`,
        userAId,
        hash("b"),
      ),
    ).rejects.toBeDefined();

    // MANUAL with importRunId populated (valid FK -> CHECK is the reason)
    await expect(
      prisma.$executeRawUnsafe(
        `${base},"importRunId") VALUES (gen_random_uuid(),$1,'EXPENSE','MANUAL',100,'BRL','2099-01-01','bad',now(),now(),$2::uuid)`,
        userAId,
        runId,
      ),
    ).rejects.toBeDefined();

    // Valid IMPORTED state (both link columns set) is accepted.
    await expect(
      prisma.$executeRawUnsafe(
        `${base},"dedupHash","importRunId") VALUES (gen_random_uuid(),$1,'EXPENSE','IMPORTED',100,'BRL','2099-01-01','check valid row',now(),now(),$2,$3::uuid)`,
        userAId,
        hash("c"),
        runId,
      ),
    ).resolves.toBe(1);
  });
});
