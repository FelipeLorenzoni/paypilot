import { NotFoundException } from "@nestjs/common";
import { FixedClock } from "../common/clock";
import type { PrismaService } from "../prisma/prisma.service";
import { PaidStatusService } from "./paid-status.service";
import type { RemindersRepository } from "./reminders.repository";

const NOW = new Date("2026-03-07T12:00:00.000Z");
const TXN_ID = "8a4f0e1a-1111-4222-8333-444455556666";

const target = {
  targetType: "RECURRING_TRANSACTION" as const,
  targetKey: `txn:${TXN_ID}`,
  transactionId: TXN_ID,
  creditCardId: null,
  invoiceCycle: null,
};

function build(
  overrides: {
    resolveOwnedTarget?: jest.Mock;
    upsert?: jest.Mock;
    deleteMany?: jest.Mock;
  } = {},
) {
  const resolveOwnedTarget =
    overrides.resolveOwnedTarget ?? jest.fn().mockResolvedValue(target);
  const upsert =
    overrides.upsert ?? jest.fn().mockResolvedValue({ paidAt: NOW });
  const deleteMany =
    overrides.deleteMany ?? jest.fn().mockResolvedValue({ count: 1 });
  const repo = { resolveOwnedTarget } as unknown as RemindersRepository;
  const prisma = {
    paymentMarker: { upsert, deleteMany },
  } as unknown as PrismaService;
  return {
    service: new PaidStatusService(prisma, repo, new FixedClock(NOW)),
    resolveOwnedTarget,
    upsert,
    deleteMany,
  };
}

const input = {
  targetType: "RECURRING_TRANSACTION" as const,
  transactionId: TXN_ID,
};

describe("PaidStatusService.setPaid", () => {
  it("marks an owned target paid idempotently (upsert, paidAt from Clock)", async () => {
    const { service, upsert } = build();
    const view = await service.setPaid("u1", input, true);
    expect(view).toEqual({
      targetType: "RECURRING_TRANSACTION",
      targetKey: `txn:${TXN_ID}`,
      paid: true,
      paidAt: NOW.toISOString(),
    });
    const arg = upsert.mock.calls[0][0];
    expect(arg.where.userId_targetType_targetKey).toEqual({
      userId: "u1",
      targetType: "RECURRING_TRANSACTION",
      targetKey: `txn:${TXN_ID}`,
    });
    expect(arg.create).toMatchObject({
      userId: "u1",
      transactionId: TXN_ID,
      paidAt: NOW,
    });
    expect(arg.update).toEqual({}); // second mark = no side effects
  });

  it("unmarks paid idempotently (delete; absent row is fine)", async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const { service } = build({ deleteMany });
    const view = await service.setPaid("u1", input, false);
    expect(view).toEqual({
      targetType: "RECURRING_TRANSACTION",
      targetKey: `txn:${TXN_ID}`,
      paid: false,
      paidAt: null,
    });
    expect(deleteMany.mock.calls[0][0].where).toMatchObject({
      userId: "u1",
      targetType: "RECURRING_TRANSACTION",
      targetKey: `txn:${TXN_ID}`,
    });
  });

  it("responds 404 without disclosure for an unowned/unknown target", async () => {
    const resolveOwnedTarget = jest.fn().mockResolvedValue(null);
    const { service, upsert } = build({ resolveOwnedTarget });
    await expect(service.setPaid("u1", input, true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(upsert).not.toHaveBeenCalled();
  });
});
