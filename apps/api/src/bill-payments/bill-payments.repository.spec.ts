import type { PrismaService } from "../prisma/prisma.service";
import {
  cardInvoiceTarget,
  recurringTarget,
} from "../reminders/domain/reminder-target";
import { BillPaymentsRepository } from "./bill-payments.repository";

const TXN_ID = "8a4f0e1a-1111-4222-8333-444455556666";
const CARD_ID = "3b2c1d0e-aaaa-4bbb-8ccc-dddd11112222";
const USER_ID = "9c8b7a6d-2222-4333-8444-555566667777";
const RECORDED_AT = new Date("2026-11-21T12:00:00.000Z");

function markerRow(over: Record<string, unknown> = {}) {
  return {
    targetType: "RECURRING_TRANSACTION",
    targetKey: `txn:${TXN_ID}`,
    paidOn: new Date("2026-11-09T00:00:00.000Z"),
    paidAt: RECORDED_AT,
    ...over,
  };
}

function build(
  overrides: {
    txFindFirst?: jest.Mock;
    cardFindFirst?: jest.Mock;
    markerFindUnique?: jest.Mock;
    markerCreate?: jest.Mock;
    markerDeleteMany?: jest.Mock;
  } = {},
) {
  const txFindFirst =
    overrides.txFindFirst ?? jest.fn().mockResolvedValue(null);
  const cardFindFirst =
    overrides.cardFindFirst ?? jest.fn().mockResolvedValue(null);
  const markerFindUnique =
    overrides.markerFindUnique ?? jest.fn().mockResolvedValue(null);
  const markerCreate =
    overrides.markerCreate ?? jest.fn().mockResolvedValue(markerRow());
  const markerDeleteMany =
    overrides.markerDeleteMany ?? jest.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    transaction: { findFirst: txFindFirst },
    creditCard: { findFirst: cardFindFirst },
    paymentMarker: {
      findUnique: markerFindUnique,
      create: markerCreate,
      deleteMany: markerDeleteMany,
    },
  } as unknown as PrismaService;
  return {
    repo: new BillPaymentsRepository(prisma),
    txFindFirst,
    cardFindFirst,
    markerFindUnique,
    markerCreate,
    markerDeleteMany,
  };
}

describe("BillPaymentsRepository.resolveOwnedTarget", () => {
  it("resolves an owned RECURRING transaction", async () => {
    const txFindFirst = jest.fn().mockResolvedValue({ id: TXN_ID });
    const { repo } = build({ txFindFirst });
    const target = await repo.resolveOwnedTarget(USER_ID, {
      targetType: "RECURRING_TRANSACTION",
      transactionId: TXN_ID,
    });
    expect(target?.targetKey).toBe(`txn:${TXN_ID}`);
    expect(txFindFirst.mock.calls[0][0].where).toMatchObject({
      id: TXN_ID,
      userId: USER_ID,
      source: "RECURRING",
    });
  });

  it("returns null for a MANUAL/IMPORTED id, unowned rows, or missing input", async () => {
    const { repo } = build(); // findFirst resolves null
    await expect(
      repo.resolveOwnedTarget(USER_ID, {
        targetType: "RECURRING_TRANSACTION",
        transactionId: TXN_ID,
      }),
    ).resolves.toBeNull();
    await expect(
      repo.resolveOwnedTarget(USER_ID, { targetType: "RECURRING_TRANSACTION" }),
    ).resolves.toBeNull();
  });

  it("resolves a card invoice only when the card is owned and the cycle has rows", async () => {
    const cardFindFirst = jest.fn().mockResolvedValue({ id: CARD_ID });
    const txFindFirst = jest.fn().mockResolvedValue({ id: "any-card-row" });
    const { repo } = build({ cardFindFirst, txFindFirst });
    const target = await repo.resolveOwnedTarget(USER_ID, {
      targetType: "CARD_INVOICE",
      creditCardId: CARD_ID,
      invoiceCycle: "2026-03",
    });
    expect(target?.targetKey).toBe(`card:${CARD_ID}:2026-03`);
    expect(cardFindFirst.mock.calls[0][0].where).toEqual({
      id: CARD_ID,
      userId: USER_ID,
    });
    expect(txFindFirst.mock.calls[0][0].where).toMatchObject({
      userId: USER_ID,
      source: "CARD",
      creditCardId: CARD_ID,
      invoiceCycle: "2026-03",
    });
  });

  it("returns null when the card is not owned or the cycle has no CARD rows", async () => {
    await expect(
      build().repo.resolveOwnedTarget(USER_ID, {
        targetType: "CARD_INVOICE",
        creditCardId: CARD_ID,
        invoiceCycle: "2026-03",
      }),
    ).resolves.toBeNull();

    const cardFindFirst = jest.fn().mockResolvedValue({ id: CARD_ID });
    const { repo } = build({ cardFindFirst }); // txFindFirst → null
    await expect(
      repo.resolveOwnedTarget(USER_ID, {
        targetType: "CARD_INVOICE",
        creditCardId: CARD_ID,
        invoiceCycle: "2026-03",
      }),
    ).resolves.toBeNull();
  });
});

describe("BillPaymentsRepository.markPaid", () => {
  const target = recurringTarget(TXN_ID);

  it("creates the record with its payment date and recorded instant", async () => {
    const { repo, markerCreate } = build();

    const record = await repo.markPaid(
      USER_ID,
      target,
      "2026-11-09",
      RECORDED_AT,
    );

    expect(markerCreate.mock.calls[0][0].data).toEqual({
      userId: USER_ID,
      targetType: "RECURRING_TRANSACTION",
      targetKey: `txn:${TXN_ID}`,
      transactionId: TXN_ID,
      creditCardId: null,
      invoiceCycle: null,
      paidOn: new Date("2026-11-09T00:00:00.000Z"),
      paidAt: RECORDED_AT,
    });
    expect(record).toEqual({
      targetType: "RECURRING_TRANSACTION",
      targetKey: `txn:${TXN_ID}`,
      paidOn: "2026-11-09",
      recordedAt: "2026-11-21T12:00:00.000Z",
    });
  });

  it("returns an existing record unchanged without writing", async () => {
    const markerFindUnique = jest
      .fn()
      .mockResolvedValue(
        markerRow({ paidOn: new Date("2026-10-30T00:00:00.000Z") }),
      );
    const { repo, markerCreate } = build({ markerFindUnique });

    const record = await repo.markPaid(
      USER_ID,
      target,
      "2026-11-21",
      RECORDED_AT,
    );

    expect(markerCreate).not.toHaveBeenCalled();
    expect(record.paidOn).toBe("2026-10-30");
    expect(markerFindUnique.mock.calls[0][0].where).toEqual({
      userId_targetType_targetKey: {
        userId: USER_ID,
        targetType: "RECURRING_TRANSACTION",
        targetKey: `txn:${TXN_ID}`,
      },
    });
  });

  it("returns the concurrent winner on a unique-key conflict", async () => {
    const markerFindUnique = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        markerRow({ paidOn: new Date("2026-11-20T00:00:00.000Z") }),
      );
    const markerCreate = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    const { repo } = build({ markerFindUnique, markerCreate });

    const record = await repo.markPaid(
      USER_ID,
      target,
      "2026-11-21",
      RECORDED_AT,
    );

    expect(record.paidOn).toBe("2026-11-20");
    expect(markerFindUnique).toHaveBeenCalledTimes(2);
  });

  it("rethrows any other write error", async () => {
    const markerCreate = jest.fn().mockRejectedValue(new Error("db down"));
    const { repo } = build({ markerCreate });

    await expect(
      repo.markPaid(USER_ID, target, "2026-11-21", RECORDED_AT),
    ).rejects.toThrow("db down");
  });

  it("stores card invoice identity columns", async () => {
    const { repo, markerCreate } = build();

    await repo.markPaid(
      USER_ID,
      cardInvoiceTarget(CARD_ID, "2026-10"),
      "2026-11-20",
      RECORDED_AT,
    );

    expect(markerCreate.mock.calls[0][0].data).toMatchObject({
      targetType: "CARD_INVOICE",
      targetKey: `card:${CARD_ID}:2026-10`,
      transactionId: null,
      creditCardId: CARD_ID,
      invoiceCycle: "2026-10",
    });
  });
});

describe("BillPaymentsRepository.unmark and findPayment", () => {
  const target = recurringTarget(TXN_ID);

  it("deletes only the user's record, idempotently", async () => {
    const markerDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const { repo } = build({ markerDeleteMany });

    await expect(repo.unmark(USER_ID, target)).resolves.toBeUndefined();
    expect(markerDeleteMany.mock.calls[0][0].where).toEqual({
      userId: USER_ID,
      targetType: "RECURRING_TRANSACTION",
      targetKey: `txn:${TXN_ID}`,
    });
  });

  it("reads one record or nothing", async () => {
    await expect(build().repo.findPayment(USER_ID, target)).resolves.toBeNull();

    const markerFindUnique = jest.fn().mockResolvedValue(markerRow());
    await expect(
      build({ markerFindUnique }).repo.findPayment(USER_ID, target),
    ).resolves.toEqual({
      targetType: "RECURRING_TRANSACTION",
      targetKey: `txn:${TXN_ID}`,
      paidOn: "2026-11-09",
      recordedAt: "2026-11-21T12:00:00.000Z",
    });
  });

  it("exposes no ledger write method", () => {
    expect(
      Object.getOwnPropertyNames(BillPaymentsRepository.prototype).sort(),
    ).toEqual([
      "constructor",
      "findPayment",
      "markPaid",
      "resolveOwnedTarget",
      "unmark",
    ]);
  });
});
