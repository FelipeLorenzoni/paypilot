import type { PrismaService } from "../prisma/prisma.service";
import { DashboardRepository } from "./dashboard.repository";

const USER_ID = "9c8b7a6d-2222-4333-8444-555566667777";
const TXN_ID = "8a4f0e1a-1111-4222-8333-444455556666";
const CARD_ID = "3b2c1d0e-aaaa-4bbb-8ccc-dddd11112222";

function dbRow(over: Record<string, unknown> = {}) {
  return {
    id: TXN_ID,
    source: "RECURRING",
    amountMinor: 85048n,
    currency: "BRL",
    transactionDate: new Date("2026-11-10T00:00:00.000Z"),
    description: "Condominium",
    categoryLabel: "Housing",
    creditCardId: null,
    invoiceCycle: null,
    creditCard: null,
    ...over,
  };
}

function build(
  overrides: { txFindMany?: jest.Mock; markerFindMany?: jest.Mock } = {},
) {
  const txFindMany = overrides.txFindMany ?? jest.fn().mockResolvedValue([]);
  const markerFindMany =
    overrides.markerFindMany ?? jest.fn().mockResolvedValue([]);
  const prisma = {
    transaction: { findMany: txFindMany },
    paymentMarker: { findMany: markerFindMany },
  } as unknown as PrismaService;
  return { repo: new DashboardRepository(prisma), txFindMany, markerFindMany };
}

describe("DashboardRepository.findMonthRows", () => {
  it("queries one user's rows inside the inclusive date range", async () => {
    const { repo, txFindMany } = build();

    await repo.findMonthRows(USER_ID, "2026-11-01", "2026-11-30");

    const arg = txFindMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      userId: USER_ID,
      transactionDate: {
        gte: new Date("2026-11-01T00:00:00.000Z"),
        lte: new Date("2026-11-30T00:00:00.000Z"),
      },
    });
    expect(arg.select.creditCard).toEqual({ select: { label: true } });
  });

  it("maps rows to date-only strings, keeping money as bigint", async () => {
    const txFindMany = jest.fn().mockResolvedValue([
      dbRow(),
      dbRow({
        id: "8a4f0e1a-1111-4222-8333-444455550000",
        source: "CARD",
        amountMinor: 1500n,
        creditCardId: CARD_ID,
        invoiceCycle: "2026-10", // CHAR(7) may come back padded elsewhere
        creditCard: { label: "Nubank" },
        categoryLabel: null,
      }),
    ]);
    const { repo } = build({ txFindMany });

    const rows = await repo.findMonthRows(USER_ID, "2026-11-01", "2026-11-30");

    expect(rows).toEqual([
      {
        id: TXN_ID,
        source: "RECURRING",
        amountMinor: 85048n,
        currency: "BRL",
        transactionDate: "2026-11-10",
        description: "Condominium",
        categoryLabel: "Housing",
        creditCardId: null,
        creditCardLabel: null,
        invoiceCycle: null,
      },
      expect.objectContaining({
        source: "CARD",
        amountMinor: 1500n,
        creditCardId: CARD_ID,
        creditCardLabel: "Nubank",
        invoiceCycle: "2026-10",
      }),
    ]);
  });

  it("trims a padded invoice cycle", async () => {
    const txFindMany = jest.fn().mockResolvedValue([
      dbRow({
        source: "CARD",
        creditCardId: CARD_ID,
        invoiceCycle: "2026-10 ",
        creditCard: { label: "Nubank" },
      }),
    ]);
    const { repo } = build({ txFindMany });

    const [row] = await repo.findMonthRows(USER_ID, "2026-11-01", "2026-11-30");

    expect(row?.invoiceCycle).toBe("2026-10");
  });
});

describe("DashboardRepository.findPayableRows", () => {
  it("queries only the user's RECURRING and CARD rows of the window", async () => {
    const { repo, txFindMany } = build();

    await repo.findPayableRows(USER_ID, "2026-08-01", "2026-10-31");

    expect(txFindMany.mock.calls[0][0].where).toEqual({
      userId: USER_ID,
      source: { in: ["RECURRING", "CARD"] },
      transactionDate: {
        gte: new Date("2026-08-01T00:00:00.000Z"),
        lte: new Date("2026-10-31T00:00:00.000Z"),
      },
    });
  });
});

describe("DashboardRepository.findPaidKeys", () => {
  it("short-circuits without a query for an empty key set", async () => {
    const { repo, markerFindMany } = build();

    await expect(repo.findPaidKeys(USER_ID, [])).resolves.toEqual([]);
    expect(markerFindMany).not.toHaveBeenCalled();
  });

  it("reads the user's markers for the given keys as ISO timestamps", async () => {
    const markerFindMany = jest.fn().mockResolvedValue([
      {
        targetKey: `txn:${TXN_ID}`,
        paidAt: new Date("2026-11-04T13:00:00.000Z"),
        paidOn: new Date("2026-11-03T00:00:00.000Z"),
      },
    ]);
    const { repo } = build({ markerFindMany });

    const markers = await repo.findPaidKeys(USER_ID, [`txn:${TXN_ID}`]);

    expect(markerFindMany.mock.calls[0][0].where).toEqual({
      userId: USER_ID,
      targetKey: { in: [`txn:${TXN_ID}`] },
    });
    expect(markers).toEqual([
      {
        targetKey: `txn:${TXN_ID}`,
        paidAt: "2026-11-04T13:00:00.000Z",
        paidOn: "2026-11-03",
      },
    ]);
  });
});

describe("DashboardRepository is read-only", () => {
  it("exposes no write method", () => {
    const methods = Object.getOwnPropertyNames(DashboardRepository.prototype);
    expect(methods.sort()).toEqual([
      "constructor",
      "findMonthRows",
      "findPaidKeys",
      "findPayableRows",
    ]);
  });
});
