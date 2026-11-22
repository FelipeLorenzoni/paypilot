import { BadRequestException, NotFoundException } from "@nestjs/common";
import { BusinessCalendar } from "../common/business-calendar";
import { FixedClock } from "../common/clock";
import type { AppConfig } from "../config/app-config";
import { recurringTarget } from "../reminders/domain/reminder-target";
import type { BillPaymentsRepository } from "./bill-payments.repository";
import { BillPaymentsService } from "./bill-payments.service";

const USER_ID = "9c8b7a6d-2222-4333-8444-555566667777";
const TXN_ID = "8a4f0e1a-1111-4222-8333-444455556666";
// 01:30Z on Nov 22 is still Nov 21 (22:30) in São Paulo: business today is
// Nov 21, while the recorded instant stays the raw UTC clock value.
const NOW = new Date("2026-11-22T01:30:00.000Z");
const TARGET = recurringTarget(TXN_ID);
const IDENTITY = {
  targetType: "RECURRING_TRANSACTION" as const,
  transactionId: TXN_ID,
};

function clockAndCalendar(): [FixedClock, BusinessCalendar] {
  const clock = new FixedClock(NOW);
  return [
    clock,
    new BusinessCalendar(clock, { timeZone: "America/Sao_Paulo" } as AppConfig),
  ];
}

function build(resolved: typeof TARGET | null = TARGET) {
  const repo = {
    resolveOwnedTarget: jest.fn().mockResolvedValue(resolved),
    markPaid: jest.fn(
      (_u: string, t: typeof TARGET, paidOn: string, at: Date) =>
        Promise.resolve({
          targetType: t.targetType,
          targetKey: t.targetKey,
          paidOn,
          recordedAt: at.toISOString(),
        }),
    ),
    unmark: jest.fn().mockResolvedValue(undefined),
  };
  const service = new BillPaymentsService(
    repo as unknown as BillPaymentsRepository,
    ...clockAndCalendar(),
  );
  return { service, repo };
}

describe("BillPaymentsService.setPayment", () => {
  it("marks paid with business today when no date is given", async () => {
    const { service, repo } = build();

    const view = await service.setPayment(USER_ID, { ...IDENTITY, paid: true });

    expect(repo.markPaid).toHaveBeenCalledWith(
      USER_ID,
      TARGET,
      "2026-11-21",
      NOW,
    );
    expect(view).toEqual({
      targetType: "RECURRING_TRANSACTION",
      targetKey: `txn:${TXN_ID}`,
      paid: true,
      paidOn: "2026-11-21",
      recordedAt: NOW.toISOString(),
    });
  });

  it("records a back-dated payment date", async () => {
    const { service, repo } = build();

    const view = await service.setPayment(USER_ID, {
      ...IDENTITY,
      paid: true,
      paidOn: "2026-11-09",
    });

    expect(repo.markPaid.mock.calls[0]?.[2]).toBe("2026-11-09");
    expect(view.paidOn).toBe("2026-11-09");
  });

  it("accepts business today as the payment date", async () => {
    const { service } = build();

    await expect(
      service.setPayment(USER_ID, {
        ...IDENTITY,
        paid: true,
        paidOn: "2026-11-21",
      }),
    ).resolves.toMatchObject({ paidOn: "2026-11-21" });
  });

  it("rejects a future payment date before resolving the target", async () => {
    const { service, repo } = build();

    await expect(
      service.setPayment(USER_ID, {
        ...IDENTITY,
        paid: true,
        paidOn: "2026-11-22", // already today in UTC, tomorrow locally
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.resolveOwnedTarget).not.toHaveBeenCalled();
    expect(repo.markPaid).not.toHaveBeenCalled();
  });

  it("rejects a payment date sent with an unmark", async () => {
    const { service, repo } = build();

    await expect(
      service.setPayment(USER_ID, {
        ...IDENTITY,
        paid: false,
        paidOn: "2026-11-09",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.unmark).not.toHaveBeenCalled();
  });

  it("is not-found for an unresolved target, writing nothing", async () => {
    const { service, repo } = build(null);

    await expect(
      service.setPayment(USER_ID, { ...IDENTITY, paid: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.setPayment(USER_ID, { ...IDENTITY, paid: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.markPaid).not.toHaveBeenCalled();
    expect(repo.unmark).not.toHaveBeenCalled();
  });

  it("unmarks and reports the item as unpaid", async () => {
    const { service, repo } = build();

    const view = await service.setPayment(USER_ID, {
      ...IDENTITY,
      paid: false,
    });

    expect(repo.unmark).toHaveBeenCalledWith(USER_ID, TARGET);
    expect(view).toEqual({
      targetType: "RECURRING_TRANSACTION",
      targetKey: `txn:${TXN_ID}`,
      paid: false,
      paidOn: null,
      recordedAt: null,
    });
  });
});
