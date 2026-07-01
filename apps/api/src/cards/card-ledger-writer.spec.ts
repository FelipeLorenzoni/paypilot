import { CardLedgerWriter, type CardPurchasePlan } from "./card-ledger-writer";
import type { PrismaService } from "../prisma/prisma.service";

function plan(overrides: Partial<CardPurchasePlan> = {}): CardPurchasePlan {
  return {
    userId: "u1",
    creditCardId: "c1",
    idempotencyKey: "key-1",
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
        installmentSeq: 2,
        installmentTotal: 2,
        amountMinor: 5000n,
        transactionDate: new Date("2026-04-20T00:00:00.000Z"),
      },
    ],
    ...overrides,
  };
}

describe("CardLedgerWriter.create", () => {
  it("persists the plan + N rows inside one transaction (all CARD/EXPENSE)", async () => {
    const purchaseCreate = jest
      .fn()
      .mockResolvedValue({ id: "p1", installments: 2 });
    const txCreate = jest
      .fn()
      .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: `t-${String(data.installmentSeq)}`, ...data }),
      );
    const tx = {
      cardPurchase: { create: purchaseCreate },
      transaction: { create: txCreate },
    };
    const prisma = {
      $transaction: (cb: (t: typeof tx) => unknown) => cb(tx),
    } as unknown as PrismaService;

    const writer = new CardLedgerWriter(prisma);
    const result = await writer.create(plan());

    expect(purchaseCreate).toHaveBeenCalledTimes(1);
    expect(txCreate).toHaveBeenCalledTimes(2);
    for (const call of txCreate.mock.calls) {
      expect(call[0].data).toMatchObject({
        source: "CARD",
        type: "EXPENSE",
        cardPurchaseId: "p1",
        creditCardId: "c1",
      });
    }
    expect(result.transactions).toHaveLength(2);
  });

  it("propagates a mid-write failure (transaction rolls back — all or none)", async () => {
    const tx = {
      cardPurchase: {
        create: jest.fn().mockResolvedValue({ id: "p1", installments: 2 }),
      },
      transaction: {
        create: jest
          .fn()
          .mockResolvedValueOnce({ id: "t1" })
          .mockRejectedValueOnce(new Error("boom")),
      },
    };
    // A real interactive $transaction rolls back on throw; the mock just
    // propagates so we assert the writer does not swallow the error.
    const prisma = {
      $transaction: (cb: (t: typeof tx) => unknown) => cb(tx),
    } as unknown as PrismaService;

    const writer = new CardLedgerWriter(prisma);
    await expect(writer.create(plan())).rejects.toThrow("boom");
  });
});
