import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

const MIGRATIONS = path.resolve(__dirname, "..", "prisma", "migrations");
const TARGET = "add_payment_date";

/**
 * bill-payments migration back-fill (requirements 1.4, 1.6): markers written
 * by due-date-reminders before the `paidOn` column existed get the UTC
 * calendar date of their `paidAt`. Migrations are applied as raw SQL so the
 * test can stop right before the target one and seed a pre-existing marker.
 */
describe("add_payment_date migration (real PostgreSQL)", () => {
  let container: StartedPostgreSqlContainer;

  /** Run SQL as a file (`-f`): statements autocommit one by one, as Prisma does. */
  async function psql(sql: string): Promise<string> {
    await container.copyContentToContainer([
      { content: sql, target: "/tmp/step.sql" },
    ]);
    const result = await container.exec([
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      container.getUsername(),
      "-d",
      container.getDatabase(),
      "-tA",
      "-q",
      "-f",
      "/tmp/step.sql",
    ]);
    if (result.exitCode !== 0) {
      throw new Error(result.output);
    }
    return result.output.trim();
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
  });

  afterAll(async () => {
    try {
      await container?.stop();
    } catch {
      /* ignore */
    }
  });

  it("back-fills paidOn from the UTC date of paidAt and makes it required", async () => {
    const dirs = readdirSync(MIGRATIONS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    const targetIndex = dirs.findIndex((d) => d.endsWith(`_${TARGET}`));
    expect(targetIndex).toBeGreaterThan(0);
    const sqlOf = (dir: string) =>
      readFileSync(path.join(MIGRATIONS, dir, "migration.sql"), "utf8");

    for (const dir of dirs.slice(0, targetIndex)) {
      await psql(sqlOf(dir));
    }

    // 02:30Z on Mar 10 is still Mar 9 in São Paulo: the back-fill must use UTC.
    await psql(`
      INSERT INTO "users" ("id", "email", "passwordHash", "updatedAt")
      VALUES ('9c8b7a6d-2222-4333-8444-555566667777', 'old@example.com', 'x', now());
      INSERT INTO "credit_cards" ("id", "userId", "label", "closingDay", "dueDay", "updatedAt")
      VALUES ('3b2c1d0e-aaaa-4bbb-8ccc-dddd11112222',
              '9c8b7a6d-2222-4333-8444-555566667777', 'Visa', 10, 20, now());
      INSERT INTO "payment_markers"
        ("id", "userId", "targetType", "targetKey", "creditCardId",
         "invoiceCycle", "paidAt", "updatedAt")
      VALUES
        ('8a4f0e1a-1111-4222-8333-444455556666',
         '9c8b7a6d-2222-4333-8444-555566667777',
         'CARD_INVOICE', 'card:3b2c1d0e-aaaa-4bbb-8ccc-dddd11112222:2026-02',
         '3b2c1d0e-aaaa-4bbb-8ccc-dddd11112222', '2026-02',
         '2026-03-10T02:30:00Z', now());
    `);

    await psql(sqlOf(dirs[targetIndex]!));

    expect(
      await psql(
        `SELECT "paidOn"::text FROM "payment_markers" WHERE "id" = '8a4f0e1a-1111-4222-8333-444455556666'`,
      ),
    ).toBe("2026-03-10");
    expect(
      await psql(
        `SELECT is_nullable FROM information_schema.columns
         WHERE table_name = 'payment_markers' AND column_name = 'paidOn'`,
      ),
    ).toBe("NO");
  });
});
