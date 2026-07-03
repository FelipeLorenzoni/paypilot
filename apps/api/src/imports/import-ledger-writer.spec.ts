import { ImportLedgerWriter, type PersistInput } from "./import-ledger-writer";
import type { PrismaService } from "../prisma/prisma.service";

const input = (over: Partial<PersistInput> = {}): PersistInput => ({
  userId: "u1",
  fileHash: "f".repeat(64),
  totalRows: 3,
  invalidCount: 1,
  candidates: [
    {
      transactionDate: new Date("2026-03-01T00:00:00.000Z"),
      amountMinor: 1050n,
      currency: "BRL",
      description: "Lunch",
      categoryLabel: null,
      dedupHash: "a".repeat(64),
    },
    {
      transactionDate: new Date("2026-03-02T00:00:00.000Z"),
      amountMinor: 2000n,
      currency: "BRL",
      description: "Taxi",
      categoryLabel: "transport",
      dedupHash: "b".repeat(64),
    },
  ],
  ...over,
});

function build(createManyCount: number) {
  const runCreate = jest.fn().mockResolvedValue({ id: "run-1" });
  const createMany = jest.fn().mockResolvedValue({ count: createManyCount });
  const runUpdate = jest.fn().mockImplementation(({ data }) =>
    Promise.resolve({
      id: "run-1",
      status: data.status,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      ...data,
    }),
  );
  const tx = {
    importRun: { create: runCreate, update: runUpdate },
    transaction: { createMany },
  };
  const prisma = {
    $transaction: (cb: (t: typeof tx) => unknown) => cb(tx),
  } as unknown as PrismaService;
  return {
    writer: new ImportLedgerWriter(prisma),
    runCreate,
    createMany,
    runUpdate,
  };
}

describe("ImportLedgerWriter.persist", () => {
  it("creates the run, inserts IMPORTED rows with skipDuplicates, finalizes counts", async () => {
    const { writer, createMany, runUpdate } = build(2);
    const result = await writer.persist(input());

    expect(createMany).toHaveBeenCalledTimes(1);
    const call = createMany.mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
    expect(call.data).toHaveLength(2);
    expect(call.data[0]).toMatchObject({
      userId: "u1",
      type: "EXPENSE",
      source: "IMPORTED",
      dedupHash: "a".repeat(64),
      importRunId: "run-1",
    });
    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          importedCount: 2,
          duplicateCount: 0,
          status: "COMPLETED",
        }),
      }),
    );
    expect(result).toMatchObject({
      runId: "run-1",
      importedCount: 2,
      duplicateCount: 0,
    });
  });

  it("derives duplicateCount from the DB insert count (source of truth)", async () => {
    const { writer } = build(1); // DB skipped one of the two candidates
    const result = await writer.persist(input());
    expect(result.importedCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
  });

  it("propagates a mid-transaction failure (rolls back — no run, no rows)", async () => {
    const tx = {
      importRun: {
        create: jest.fn().mockResolvedValue({ id: "run-1" }),
        update: jest.fn(),
      },
      transaction: {
        createMany: jest.fn().mockRejectedValue(new Error("boom")),
      },
    };
    const prisma = {
      $transaction: (cb: (t: typeof tx) => unknown) => cb(tx),
    } as unknown as PrismaService;
    const writer = new ImportLedgerWriter(prisma);
    await expect(writer.persist(input())).rejects.toThrow("boom");
    expect(tx.importRun.update).not.toHaveBeenCalled();
  });
});
