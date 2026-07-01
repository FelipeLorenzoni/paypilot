import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { CardLedgerWriter } from "./card-ledger-writer";
import type { CreditCardsRepository } from "./credit-cards.repository";
import { PurchasesService } from "./purchases.service";

const findOwned = jest.fn();
const writerCreate = jest.fn();
const writerFindByKey = jest.fn();

const cards = { findOwned } as unknown as CreditCardsRepository;
const writer = {
  create: writerCreate,
  findByKey: writerFindByKey,
} as unknown as CardLedgerWriter;
const service = new PurchasesService(cards, writer);

const card = (overrides: Record<string, unknown> = {}) => ({
  id: "c1",
  userId: "u1",
  closingDay: 10,
  dueDay: 20,
  isActive: true,
  ...overrides,
});

const dto = (overrides: Record<string, unknown> = {}) => ({
  idempotencyKey: "key-1",
  purchaseDate: "2026-03-05",
  amountMinor: 10000,
  currency: "BRL",
  description: "TV",
  installments: 2,
  ...overrides,
});

afterEach(() => jest.clearAllMocks());

describe("PurchasesService.create", () => {
  it("throws 404 when the card is not owned/found", async () => {
    findOwned.mockResolvedValue(null);
    await expect(service.create("u1", "c1", dto())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("throws 400 when the card is inactive", async () => {
    findOwned.mockResolvedValue(card({ isActive: false }));
    await expect(service.create("u1", "c1", dto())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("assigns the cycle, splits amounts, and writes N rows", async () => {
    findOwned.mockResolvedValue(card());
    writerCreate.mockImplementation((plan) =>
      Promise.resolve({
        purchase: {
          id: "p1",
          creditCardId: "c1",
          installments: plan.installments,
        },
        transactions: plan.rows.map(
          (r: Record<string, unknown>, i: number) => ({
            id: `t${i}`,
            amountMinor: r.amountMinor,
            currency: plan.currency,
            transactionDate: r.transactionDate,
            invoiceCycle: r.invoiceCycle,
            installmentSeq: r.installmentSeq,
            installmentTotal: r.installmentTotal,
            description: plan.description,
            categoryLabel: plan.categoryLabel,
          }),
        ),
      }),
    );

    const res = await service.create(
      "u1",
      "c1",
      dto({ amountMinor: 10000, installments: 3 }),
    );
    const call = writerCreate.mock.calls[0][0];
    // purchaseDate 2026-03-05, closingDay 10 -> on/before closing -> cycle 2026-03
    expect(call.startCycle).toBe("2026-03");
    expect(call.rows).toHaveLength(3);
    expect(
      call.rows.map((r: { invoiceCycle: string }) => r.invoiceCycle),
    ).toEqual(["2026-03", "2026-04", "2026-05"]);
    // 10000 / 3 -> remainder on first
    expect(
      call.rows.map((r: { amountMinor: bigint }) => r.amountMinor),
    ).toEqual([3334n, 3333n, 3333n]);
    // due date for cycle 2026-03 with closing 10 / due 20 -> 2026-03-20
    expect(call.rows[0].transactionDate.toISOString()).toBe(
      "2026-03-20T00:00:00.000Z",
    );
    expect(res.installments).toBe(3);
    expect(res.transactions).toHaveLength(3);
  });

  it("rolls the purchase to next cycle after the closing day", async () => {
    findOwned.mockResolvedValue(card());
    writerCreate.mockResolvedValue({
      purchase: { id: "p1", creditCardId: "c1", installments: 1 },
      transactions: [],
    });
    await service.create(
      "u1",
      "c1",
      dto({ purchaseDate: "2026-03-11", installments: 1 }),
    );
    expect(writerCreate.mock.calls[0][0].startCycle).toBe("2026-04");
  });

  it("returns the existing purchase on a duplicate key with matching payload", async () => {
    findOwned.mockResolvedValue(card());
    writerCreate.mockRejectedValue({ code: "P2002" });
    writerFindByKey.mockImplementation(async () => ({
      purchase: {
        id: "existing",
        creditCardId: "c1",
        installments: 2,
        // recompute the same hash the service will produce for dto()
        requestHash: (await import("node:crypto"))
          .createHash("sha256")
          .update(
            JSON.stringify({
              creditCardId: "c1",
              purchaseDate: "2026-03-05",
              amountMinor: 10000,
              currency: "BRL",
              description: "TV",
              category: null,
              installments: 2,
            }),
          )
          .digest("hex"),
      },
      transactions: [],
    }));

    const res = await service.create("u1", "c1", dto());
    expect(res.id).toBe("existing");
  });

  it("throws 409 on a duplicate key with a divergent payload", async () => {
    findOwned.mockResolvedValue(card());
    writerCreate.mockRejectedValue({ code: "P2002" });
    writerFindByKey.mockResolvedValue({
      purchase: {
        id: "existing",
        creditCardId: "c1",
        installments: 2,
        requestHash: "different-hash",
      },
      transactions: [],
    });
    await expect(service.create("u1", "c1", dto())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("throws 409 when the same key belongs to a different card", async () => {
    findOwned.mockResolvedValue(card());
    writerCreate.mockRejectedValue({ code: "P2002" });
    writerFindByKey.mockResolvedValue({
      purchase: {
        id: "existing",
        creditCardId: "OTHER",
        installments: 2,
        requestHash: "x",
      },
      transactions: [],
    });
    await expect(service.create("u1", "c1", dto())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
