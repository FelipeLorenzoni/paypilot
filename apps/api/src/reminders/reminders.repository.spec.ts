import type { PrismaService } from "../prisma/prisma.service";
import { RemindersRepository } from "./reminders.repository";

const TXN_ID = "8a4f0e1a-1111-4222-8333-444455556666";
const CARD_ID = "3b2c1d0e-aaaa-4bbb-8ccc-dddd11112222";
const USER_ID = "9c8b7a6d-2222-4333-8444-555566667777";

const settings = { phoneE164: "+5511999998888" };

function recurringRow(over: Record<string, unknown> = {}) {
  return {
    id: TXN_ID,
    userId: USER_ID,
    amountMinor: 12000n,
    currency: "BRL",
    transactionDate: new Date("2026-03-10T00:00:00.000Z"),
    description: "Internet",
    user: { reminderSettings: settings },
    ...over,
  };
}

function cardRow(over: Record<string, unknown> = {}) {
  return {
    userId: USER_ID,
    creditCardId: CARD_ID,
    invoiceCycle: "2026-03",
    amountMinor: 5000n,
    transactionDate: new Date("2026-03-20T00:00:00.000Z"),
    creditCard: { label: "Visa Gold" },
    user: { reminderSettings: settings },
    ...over,
  };
}

function build(
  overrides: {
    txFindMany?: jest.Mock;
    markerFindMany?: jest.Mock;
    markerFindUnique?: jest.Mock;
    txFindFirst?: jest.Mock;
    cardFindFirst?: jest.Mock;
  } = {},
) {
  const txFindMany = overrides.txFindMany ?? jest.fn().mockResolvedValue([]);
  const markerFindMany =
    overrides.markerFindMany ?? jest.fn().mockResolvedValue([]);
  const markerFindUnique =
    overrides.markerFindUnique ?? jest.fn().mockResolvedValue(null);
  const txFindFirst =
    overrides.txFindFirst ?? jest.fn().mockResolvedValue(null);
  const cardFindFirst =
    overrides.cardFindFirst ?? jest.fn().mockResolvedValue(null);
  const prisma = {
    transaction: { findMany: txFindMany, findFirst: txFindFirst },
    paymentMarker: { findMany: markerFindMany, findUnique: markerFindUnique },
    creditCard: { findFirst: cardFindFirst },
  } as unknown as PrismaService;
  return {
    repo: new RemindersRepository(prisma),
    txFindMany,
    markerFindMany,
    markerFindUnique,
    txFindFirst,
    cardFindFirst,
  };
}

describe("RemindersRepository.findDueItems", () => {
  it("maps RECURRING rows to due items with destination and txn identity", async () => {
    const txFindMany = jest
      .fn()
      .mockResolvedValueOnce([recurringRow()]) // RECURRING query
      .mockResolvedValueOnce([]); // CARD query
    const { repo } = build({ txFindMany });

    const items = await repo.findDueItems(["2026-03-10", "2026-03-13"]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      userId: USER_ID,
      destination: "+5511999998888",
      dueDate: "2026-03-10",
      description: "Internet",
      amountMinor: 12000,
      currency: "BRL",
      target: {
        targetType: "RECURRING_TRANSACTION",
        targetKey: `txn:${TXN_ID}`,
      },
    });
    // Selection-level paid filter for RECURRING rides on the relation filter.
    const where = txFindMany.mock.calls[0][0].where;
    expect(where.paymentMarkers).toEqual({ none: {} });
    expect(where.source).toBe("RECURRING");
  });

  it("groups CARD rows into one invoice item summing its installments", async () => {
    const txFindMany = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        cardRow({ amountMinor: 5000n }),
        cardRow({ amountMinor: 2550n }),
      ]);
    const { repo } = build({ txFindMany });

    const items = await repo.findDueItems(["2026-03-20"]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      dueDate: "2026-03-20",
      description: "Visa Gold",
      amountMinor: 7550,
      target: {
        targetType: "CARD_INVOICE",
        targetKey: `card:${CARD_ID}:2026-03`,
      },
    });
  });

  it("excludes card invoices with an invoice-level paid marker", async () => {
    const txFindMany = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([cardRow()]);
    const markerFindMany = jest
      .fn()
      .mockResolvedValue([
        { userId: USER_ID, targetKey: `card:${CARD_ID}:2026-03` },
      ]);
    const { repo } = build({ txFindMany, markerFindMany });

    const items = await repo.findDueItems(["2026-03-20"]);
    expect(items).toHaveLength(0);
  });

  it("returns nothing for an empty due-date list without querying", async () => {
    const { repo, txFindMany } = build();
    expect(await repo.findDueItems([])).toEqual([]);
    expect(txFindMany).not.toHaveBeenCalled();
  });
});

describe("RemindersRepository.isPaid", () => {
  it("is true iff a marker row exists for the canonical identity", async () => {
    const markerFindUnique = jest.fn().mockResolvedValue({ id: "m1" });
    const { repo } = build({ markerFindUnique });
    const target = {
      targetType: "RECURRING_TRANSACTION" as const,
      targetKey: `txn:${TXN_ID}`,
      transactionId: TXN_ID,
      creditCardId: null,
      invoiceCycle: null,
    };
    await expect(repo.isPaid(USER_ID, target)).resolves.toBe(true);
    expect(markerFindUnique).toHaveBeenCalledWith({
      where: {
        userId_targetType_targetKey: {
          userId: USER_ID,
          targetType: "RECURRING_TRANSACTION",
          targetKey: `txn:${TXN_ID}`,
        },
      },
    });
  });
});
