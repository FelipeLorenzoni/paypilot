import { NotFoundException } from "@nestjs/common";
import type { CreditCardsRepository } from "./credit-cards.repository";
import { InvoicesService } from "./invoices.service";
import type { BillPaymentsRepository } from "../bill-payments/bill-payments.repository";
import type { PrismaService } from "../prisma/prisma.service";

const CARD_ID = "3b2c1d0e-aaaa-4bbb-8ccc-dddd11112222";
const findOwned = jest.fn();
const findMany = jest.fn();
const findPayment = jest.fn();

const cards = { findOwned } as unknown as CreditCardsRepository;
const prisma = { transaction: { findMany } } as unknown as PrismaService;
const payments = { findPayment } as unknown as BillPaymentsRepository;
const service = new InvoicesService(cards, prisma, payments);

const card = (overrides: Record<string, unknown> = {}) => ({
  id: CARD_ID,
  userId: "u1",
  closingDay: 10,
  dueDay: 20,
  isActive: true,
  ...overrides,
});

const txRow = (seq: number, amount: bigint) => ({
  id: `t${seq}`,
  amountMinor: amount,
  currency: "BRL",
  transactionDate: new Date("2026-03-20T00:00:00.000Z"),
  invoiceCycle: "2026-03",
  installmentSeq: seq,
  installmentTotal: 3,
  description: "TV",
  categoryLabel: null,
});

beforeEach(() => findPayment.mockResolvedValue(null));
afterEach(() => jest.clearAllMocks());

describe("InvoicesService.getInvoice", () => {
  it("throws 404 for an unknown/cross-user card", async () => {
    findOwned.mockResolvedValue(null);
    await expect(
      service.getInvoice("u1", CARD_ID, "2026-03"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("sums the assigned rows exactly and computes the due date", async () => {
    findOwned.mockResolvedValue(card());
    findMany.mockResolvedValue([
      txRow(1, 3334n),
      txRow(2, 3333n),
      txRow(3, 3333n),
    ]);
    const inv = await service.getInvoice("u1", CARD_ID, "2026-03");
    expect(inv.totalMinor).toBe(10000);
    expect(inv.dueDate).toBe("2026-03-20"); // dueDay 20 > closingDay 10 -> same month
    expect(inv.transactions).toHaveLength(3);
    expect(typeof inv.totalMinor).toBe("number");
  });

  it("returns a zero-total invoice for an empty cycle (owned card)", async () => {
    findOwned.mockResolvedValue(card());
    findMany.mockResolvedValue([]);
    const inv = await service.getInvoice("u1", CARD_ID, "2026-09");
    expect(inv.totalMinor).toBe(0);
    expect(inv.transactions).toEqual([]);
  });

  it("reports an unpaid invoice", async () => {
    findOwned.mockResolvedValue(card());
    findMany.mockResolvedValue([txRow(1, 5000n)]);
    const inv = await service.getInvoice("u1", CARD_ID, "2026-03");
    expect(inv.paid).toBe(false);
    expect(inv.paidOn).toBeNull();
  });

  it("reports the invoice-level payment of the user", async () => {
    findOwned.mockResolvedValue(card());
    findMany.mockResolvedValue([txRow(1, 5000n)]);
    findPayment.mockResolvedValue({
      targetType: "CARD_INVOICE",
      targetKey: `card:${CARD_ID}:2026-03`,
      paidOn: "2026-03-18",
      recordedAt: "2026-03-18T15:00:00.000Z",
    });
    const inv = await service.getInvoice("u1", CARD_ID, "2026-03");
    expect(inv).toMatchObject({ paid: true, paidOn: "2026-03-18" });
    const [userId, target] = findPayment.mock.calls[0] as [
      string,
      { targetKey: string },
    ];
    expect(userId).toBe("u1");
    expect(target.targetKey).toBe(`card:${CARD_ID}:2026-03`);
  });

  it("still returns invoices for a deactivated card", async () => {
    findOwned.mockResolvedValue(card({ isActive: false }));
    findMany.mockResolvedValue([txRow(1, 5000n)]);
    const inv = await service.getInvoice("u1", CARD_ID, "2026-03");
    expect(inv.totalMinor).toBe(5000);
  });
});
