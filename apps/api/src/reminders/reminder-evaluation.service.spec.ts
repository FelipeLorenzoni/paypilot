import type { NotificationProvider } from "../integrations/notifications/notification-provider";
import type { ReminderDeliveryStore } from "./reminder-delivery.store";
import { ReminderEvaluationService } from "./reminder-evaluation.service";
import type { RemindersRepository } from "./reminders.repository";

const TXN_ID = "8a4f0e1a-1111-4222-8333-444455556666";
const TODAY = "2026-03-07";

function dueItem(over: Record<string, unknown> = {}) {
  return {
    target: {
      targetType: "RECURRING_TRANSACTION" as const,
      targetKey: `txn:${TXN_ID}`,
      transactionId: TXN_ID,
      creditCardId: null,
      invoiceCycle: null,
    },
    userId: "u1",
    destination: "+5511999998888",
    dueDate: "2026-03-10", // D-3 relative to TODAY
    description: "Internet",
    amountMinor: 12000,
    currency: "BRL",
    ...over,
  };
}

function build(
  overrides: {
    findDueItems?: jest.Mock;
    isPaid?: jest.Mock;
    claim?: jest.Mock;
    finalize?: jest.Mock;
    send?: jest.Mock;
  } = {},
) {
  const findDueItems =
    overrides.findDueItems ?? jest.fn().mockResolvedValue([dueItem()]);
  const isPaid = overrides.isPaid ?? jest.fn().mockResolvedValue(false);
  const claim = overrides.claim ?? jest.fn().mockResolvedValue("claimed");
  const finalize = overrides.finalize ?? jest.fn().mockResolvedValue(undefined);
  const send = overrides.send ?? jest.fn().mockResolvedValue({ ok: true });
  const repo = { findDueItems, isPaid } as unknown as RemindersRepository;
  const store = { claim, finalize } as unknown as ReminderDeliveryStore;
  const provider = { send } as NotificationProvider;
  return {
    service: new ReminderEvaluationService(repo, store, provider),
    findDueItems,
    isPaid,
    claim,
    finalize,
    send,
  };
}

describe("ReminderEvaluationService.evaluate", () => {
  it("queries exactly the window due dates and sends a claimed unpaid item", async () => {
    const { service, findDueItems, claim, send, finalize } = build();

    const summary = await service.evaluate(TODAY);

    expect(findDueItems).toHaveBeenCalledWith(["2026-03-10", "2026-03-07"]); // D-3, D-0
    expect(claim.mock.calls[0][0]).toMatchObject({
      userId: "u1",
      dueDate: "2026-03-10",
      windowDaysBefore: 3,
      channel: "WHATSAPP",
    });
    expect(send.mock.calls[0][0]).toMatchObject({
      channel: "WHATSAPP",
      destination: "+5511999998888",
    });
    expect(send.mock.calls[0][0].body).toContain("Internet");
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({ windowDaysBefore: 3 }),
      "SENT",
    );
    expect(summary).toEqual({
      evaluated: 1,
      sent: 1,
      skippedClaimed: 0,
      skippedPaid: 0,
      failed: 0,
    });
  });

  it("never sends without a successful claim", async () => {
    const claim = jest.fn().mockResolvedValue("already-owned");
    const { service, send, isPaid } = build({ claim });
    const summary = await service.evaluate(TODAY);
    expect(send).not.toHaveBeenCalled();
    expect(isPaid).not.toHaveBeenCalled();
    expect(summary.skippedClaimed).toBe(1);
  });

  it("finalizes SKIPPED and never calls the provider when paid at send time", async () => {
    const isPaid = jest.fn().mockResolvedValue(true);
    const { service, send, finalize } = build({ isPaid });
    const summary = await service.evaluate(TODAY);
    expect(send).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith(expect.anything(), "SKIPPED");
    expect(summary.skippedPaid).toBe(1);
  });

  it("finalizes FAILED with the wrapped error code on provider failure", async () => {
    const send = jest
      .fn()
      .mockResolvedValue({ ok: false, errorCode: "WHATSAPP_NOT_IMPLEMENTED" });
    const { service, finalize } = build({ send });
    const summary = await service.evaluate(TODAY);
    expect(finalize).toHaveBeenCalledWith(
      expect.anything(),
      "FAILED",
      "WHATSAPP_NOT_IMPLEMENTED",
    );
    expect(summary.failed).toBe(1);
  });

  it("isolates a throwing item: others still process and the run completes", async () => {
    const findDueItems = jest.fn().mockResolvedValue([
      dueItem(),
      dueItem({
        target: {
          targetType: "RECURRING_TRANSACTION",
          targetKey: "txn:9b5e1f2b-3333-4444-8555-666677778888",
          transactionId: "9b5e1f2b-3333-4444-8555-666677778888",
          creditCardId: null,
          invoiceCycle: null,
        },
      }),
    ]);
    const claim = jest
      .fn()
      .mockRejectedValueOnce(new Error("db hiccup"))
      .mockResolvedValueOnce("claimed");
    const { service, send } = build({ findDueItems, claim });

    const summary = await service.evaluate(TODAY);

    expect(send).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ evaluated: 2, sent: 1, failed: 1 });
  });

  it("sends both windows when an item matches D-0 and another matches D-3", async () => {
    const findDueItems = jest
      .fn()
      .mockResolvedValue([dueItem(), dueItem({ dueDate: TODAY })]);
    const { service, claim } = build({ findDueItems });
    const summary = await service.evaluate(TODAY);
    expect(summary.sent).toBe(2);
    const windows = claim.mock.calls.map(
      (c: [{ windowDaysBefore: number }]) => c[0].windowDaysBefore,
    );
    expect(windows.sort()).toEqual([0, 3]);
  });
});
