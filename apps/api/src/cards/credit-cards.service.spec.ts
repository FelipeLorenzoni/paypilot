import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { CreditCardRow } from "./card.mapper";
import { CreditCardsService } from "./credit-cards.service";
import type { CreditCardsRepository } from "./credit-cards.repository";

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
} as unknown as CreditCardsRepository;
const service = new CreditCardsService(repo);

function row(overrides: Partial<CreditCardRow> = {}): CreditCardRow {
  const ts = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "c1",
    userId: "u1",
    label: "Visa",
    closingDay: 10,
    dueDay: 20,
    creditLimitMinor: 500000n,
    isActive: true,
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

afterEach(() => jest.clearAllMocks());

describe("CreditCardsService", () => {
  it("create maps the credit limit and returns a mapped response", async () => {
    create.mockResolvedValue(row());
    const res = await service.create("u1", {
      label: "Visa",
      closingDay: 10,
      dueDay: 20,
      creditLimitMinor: 500000,
    });
    expect(create).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ creditLimitMinor: 500000n, closingDay: 10 }),
    );
    expect(res).toMatchObject({
      label: "Visa",
      creditLimitMinor: 500000,
      isActive: true,
    });
    expect(typeof res.creditLimitMinor).toBe("number");
  });

  it("create stores a null limit when omitted", async () => {
    create.mockResolvedValue(row({ creditLimitMinor: null }));
    await service.create("u1", { label: "Visa", closingDay: 10, dueDay: 20 });
    expect(create).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ creditLimitMinor: null }),
    );
  });

  it("get throws 404 when not owned/found", async () => {
    findOwned.mockResolvedValue(null);
    await expect(service.get("u1", "c1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("update rejects an empty PATCH body with 400", async () => {
    await expect(service.update("u1", "c1", {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("update throws 404 when not owned/found", async () => {
    findOwned.mockResolvedValue(null);
    await expect(
      service.update("u1", "c1", { label: "New" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("update applies editable fields", async () => {
    findOwned.mockResolvedValue(row());
    updateOwned.mockResolvedValue(row({ closingDay: 15 }));
    await service.update("u1", "c1", { closingDay: 15 });
    expect(updateOwned).toHaveBeenCalledWith(
      "u1",
      "c1",
      expect.objectContaining({ closingDay: 15 }),
    );
  });

  it("deactivate throws 404 when nothing was deactivated", async () => {
    deactivateOwned.mockResolvedValue(false);
    await expect(service.deactivate("u1", "c1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("deactivate resolves when the owned card was deactivated", async () => {
    deactivateOwned.mockResolvedValue(true);
    await expect(service.deactivate("u1", "c1")).resolves.toBeUndefined();
  });
});
