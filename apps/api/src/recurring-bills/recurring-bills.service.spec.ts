import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { RecurringBillRow } from "./recurring-bill.mapper";
import type { RecurringBillsRepository } from "./recurring-bills.repository";
import { RecurringBillsService } from "./recurring-bills.service";

const create = jest.fn();
const findOwned = jest.fn();
const findManyWithCount = jest.fn();
const updateOwned = jest.fn();
const deactivateOwned = jest.fn();

const repo = {
  create,
  findOwned,
  findManyWithCount,
  updateOwned,
  deactivateOwned,
} as unknown as RecurringBillsRepository;
const service = new RecurringBillsService(repo);

function row(overrides: Partial<RecurringBillRow> = {}): RecurringBillRow {
  const ts = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "b1",
    userId: "u1",
    amountMinor: 5000n,
    currency: "BRL",
    dayOfMonth: 10,
    description: "Rent",
    categoryLabel: null,
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    endDate: null,
    isActive: true,
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

afterEach(() => jest.clearAllMocks());

describe("RecurringBillsService", () => {
  it("create maps money/dates and returns a mapped response", async () => {
    create.mockResolvedValue(row());
    const res = await service.create("u1", {
      amountMinor: 5000,
      currency: "BRL",
      dayOfMonth: 10,
      description: "Rent",
      startDate: "2026-01-01",
    });
    expect(create).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        amountMinor: 5000n,
        currency: "BRL",
        dayOfMonth: 10,
      }),
    );
    expect(res).toMatchObject({
      amountMinor: 5000,
      currency: "BRL",
      isActive: true,
    });
    expect(typeof res.amountMinor).toBe("number");
  });

  it("create rejects endDate before startDate with 400", async () => {
    await expect(
      service.create("u1", {
        amountMinor: 5000,
        currency: "BRL",
        dayOfMonth: 10,
        description: "Rent",
        startDate: "2026-06-01",
        endDate: "2026-05-01",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it("get throws 404 when not owned/found", async () => {
    findOwned.mockResolvedValue(null);
    await expect(service.get("u1", "b1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("update rejects an empty PATCH body with 400", async () => {
    await expect(service.update("u1", "b1", {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("update merges a money patch with the persisted currency", async () => {
    findOwned.mockResolvedValue(row({ amountMinor: 5000n, currency: "BRL" }));
    updateOwned.mockResolvedValue(row({ amountMinor: 9000n }));
    await service.update("u1", "b1", { amountMinor: 9000 });
    expect(updateOwned).toHaveBeenCalledWith(
      "u1",
      "b1",
      expect.objectContaining({ amountMinor: 9000n, currency: "BRL" }),
    );
  });

  it("update rejects a patched endDate before the persisted startDate", async () => {
    findOwned.mockResolvedValue(
      row({ startDate: new Date("2026-06-01T00:00:00.000Z") }),
    );
    await expect(
      service.update("u1", "b1", { endDate: "2026-05-01" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("deactivate throws 404 when nothing was deactivated", async () => {
    deactivateOwned.mockResolvedValue(false);
    await expect(service.deactivate("u1", "b1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("deactivate resolves when the owned bill was deactivated", async () => {
    deactivateOwned.mockResolvedValue(true);
    await expect(service.deactivate("u1", "b1")).resolves.toBeUndefined();
  });
});
