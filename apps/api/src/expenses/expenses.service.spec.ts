import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { TransactionRow } from "./expense.mapper";
import { ExpensesService } from "./expenses.service";
import type { ExpensesRepository } from "./expenses.repository";

const create = jest.fn();
const findOwned = jest.fn();
const findManyWithCount = jest.fn();
const updateOwned = jest.fn();
const deleteOwned = jest.fn();

const repo = {
  create,
  findOwned,
  findManyWithCount,
  updateOwned,
  deleteOwned,
} as unknown as ExpensesRepository;
const service = new ExpensesService(repo);

function row(overrides: Partial<TransactionRow> = {}): TransactionRow {
  const ts = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "t1",
    userId: "u1",
    type: "EXPENSE",
    source: "MANUAL",
    amountMinor: 1000n,
    currency: "BRL",
    transactionDate: new Date("2026-03-01T00:00:00.000Z"),
    description: "Lunch",
    categoryLabel: null,
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

afterEach(() => jest.clearAllMocks());

describe("ExpensesService", () => {
  it("create sets type=EXPENSE/source=MANUAL and returns a mapped response", async () => {
    create.mockResolvedValue(row());
    const res = await service.create("u1", {
      amountMinor: 1000,
      currency: "BRL",
      expenseDate: "2026-03-01",
      description: "Lunch",
    });
    expect(create).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        type: "EXPENSE",
        source: "MANUAL",
        amountMinor: 1000n,
        currency: "BRL",
      }),
    );
    expect(res).toMatchObject({
      amountMinor: 1000,
      currency: "BRL",
      expenseDate: "2026-03-01",
      type: "EXPENSE",
      source: "MANUAL",
    });
    expect(typeof res.amountMinor).toBe("number");
  });

  it("get throws 404 when the expense is not owned/found", async () => {
    findOwned.mockResolvedValue(null);
    await expect(service.get("u1", "t1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("update rejects an empty PATCH body with 400", async () => {
    await expect(service.update("u1", "t1", {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("update throws 404 when not owned/found", async () => {
    findOwned.mockResolvedValue(null);
    await expect(
      service.update("u1", "t1", { description: "New" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("update merges a money patch with the persisted currency", async () => {
    findOwned.mockResolvedValue(row({ amountMinor: 1000n, currency: "BRL" }));
    updateOwned.mockResolvedValue(row({ amountMinor: 2000n }));
    await service.update("u1", "t1", { amountMinor: 2000 });
    expect(updateOwned).toHaveBeenCalledWith(
      "u1",
      "t1",
      expect.objectContaining({ amountMinor: 2000n, currency: "BRL" }),
    );
  });

  it("remove throws 404 when nothing was deleted", async () => {
    deleteOwned.mockResolvedValue(false);
    await expect(service.remove("u1", "t1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
