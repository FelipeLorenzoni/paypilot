import { FixedClock } from "../common/clock";
import type { PrismaService } from "../prisma/prisma.service";
import { ReminderDeliveryStore } from "./reminder-delivery.store";

const NOW = new Date("2026-03-07T12:00:00.000Z");
const TXN_ID = "8a4f0e1a-1111-4222-8333-444455556666";

const identity = {
  userId: "u1",
  target: {
    targetType: "RECURRING_TRANSACTION" as const,
    targetKey: `txn:${TXN_ID}`,
    transactionId: TXN_ID,
    creditCardId: null,
    invoiceCycle: null,
  },
  dueDate: "2026-03-10",
  windowDaysBefore: 3,
  channel: "WHATSAPP" as const,
};

function uniqueViolation(): Error & { code: string } {
  return Object.assign(new Error("unique"), { code: "P2002" });
}

function build(
  overrides: {
    create?: jest.Mock;
    updateMany?: jest.Mock;
  } = {},
) {
  const create = overrides.create ?? jest.fn().mockResolvedValue({ id: "d1" });
  const updateMany =
    overrides.updateMany ?? jest.fn().mockResolvedValue({ count: 0 });
  const prisma = {
    reminderDelivery: { create, updateMany },
  } as unknown as PrismaService;
  return {
    store: new ReminderDeliveryStore(prisma, new FixedClock(NOW)),
    create,
    updateMany,
  };
}

describe("ReminderDeliveryStore.claim", () => {
  it("claims a fresh identity by inserting PENDING attempt 1", async () => {
    const { store, create, updateMany } = build();
    await expect(store.claim(identity)).resolves.toBe("claimed");
    expect(create.mock.calls[0][0].data).toMatchObject({
      userId: "u1",
      targetType: "RECURRING_TRANSACTION",
      targetKey: `txn:${TXN_ID}`,
      transactionId: TXN_ID,
      windowDaysBefore: 3,
      channel: "WHATSAPP",
      status: "PENDING",
      attempt: 1,
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("re-claims a FAILED or stale-PENDING row atomically on unique conflict", async () => {
    const create = jest.fn().mockRejectedValue(uniqueViolation());
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { store } = build({ create, updateMany });

    await expect(store.claim(identity)).resolves.toBe("claimed");

    const arg = updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      userId: "u1",
      targetKey: `txn:${TXN_ID}`,
      windowDaysBefore: 3,
      channel: "WHATSAPP",
    });
    // Re-claimable states only: FAILED, or PENDING staler than the threshold.
    expect(arg.where.OR).toEqual([
      { status: "FAILED" },
      {
        status: "PENDING",
        updatedAt: { lt: new Date("2026-03-07T00:00:00.000Z") }, // NOW − 12h
      },
    ]);
    expect(arg.data).toMatchObject({
      status: "PENDING",
      attempt: { increment: 1 },
      errorCode: null,
    });
  });

  it("reports already-owned when the existing row is not re-claimable", async () => {
    const create = jest.fn().mockRejectedValue(uniqueViolation());
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const { store } = build({ create, updateMany });
    await expect(store.claim(identity)).resolves.toBe("already-owned");
  });

  it("propagates non-unique-violation errors", async () => {
    const create = jest.fn().mockRejectedValue(new Error("boom"));
    const { store } = build({ create });
    await expect(store.claim(identity)).rejects.toThrow("boom");
  });
});

describe("ReminderDeliveryStore.finalize", () => {
  it("finalizes SENT with sentAt from the injected clock, guarded on PENDING", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { store } = build({ updateMany });
    await store.finalize(identity, "SENT");
    const arg = updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ status: "PENDING" });
    expect(arg.data).toMatchObject({ status: "SENT", sentAt: NOW });
  });

  it("finalizes FAILED with a stable error code and no sentAt", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { store } = build({ updateMany });
    await store.finalize(identity, "FAILED", "WHATSAPP_NOT_IMPLEMENTED");
    const arg = updateMany.mock.calls[0][0];
    expect(arg.data).toMatchObject({
      status: "FAILED",
      errorCode: "WHATSAPP_NOT_IMPLEMENTED",
    });
    expect(arg.data.sentAt).toBeUndefined();
  });

  it("finalizes SKIPPED (paid or opted out at send time)", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { store } = build({ updateMany });
    await store.finalize(identity, "SKIPPED");
    expect(updateMany.mock.calls[0][0].data).toMatchObject({
      status: "SKIPPED",
    });
  });
});
