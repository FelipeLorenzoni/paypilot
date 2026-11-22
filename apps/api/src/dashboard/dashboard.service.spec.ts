import { FixedClock } from "../common/clock";
import type { DashboardRepository } from "./dashboard.repository";
import { DashboardService } from "./dashboard.service";
import type { LedgerRow } from "./domain/summarize-month";

const USER_ID = "9c8b7a6d-2222-4333-8444-555566667777";
const TXN_ID = "8a4f0e1a-1111-4222-8333-444455556666";
const OLD_TXN_ID = "8a4f0e1a-1111-4222-8333-444455550000";

function recurringRow(id: string, dueDate: string): LedgerRow {
  return {
    id,
    source: "RECURRING",
    amountMinor: 85048n,
    currency: "BRL",
    transactionDate: dueDate,
    description: "Condominium",
    categoryLabel: null,
    creditCardId: null,
    creditCardLabel: null,
    invoiceCycle: null,
  };
}

function build(
  now: string,
  overrides: {
    monthRows?: LedgerRow[];
    payableRows?: LedgerRow[];
  } = {},
) {
  const repo = {
    findMonthRows: jest.fn().mockResolvedValue(overrides.monthRows ?? []),
    findPayableRows: jest.fn().mockResolvedValue(overrides.payableRows ?? []),
    findPaidKeys: jest.fn().mockResolvedValue([]),
  };
  const service = new DashboardService(
    repo as unknown as DashboardRepository,
    new FixedClock(new Date(now)),
  );
  return { service, repo };
}

describe("DashboardService.getSummary", () => {
  it("defaults to the clock's UTC month and derives today from it", async () => {
    // 22:30 on Nov 30 at UTC-3 is already Dec 1 in UTC.
    const { service, repo } = build("2026-12-01T01:30:00.000Z");

    const view = await service.getSummary(USER_ID);

    expect(view.month).toBe("2026-12");
    expect(view.today).toBe("2026-12-01");
    expect(repo.findMonthRows).toHaveBeenCalledWith(
      USER_ID,
      "2026-12-01",
      "2026-12-31",
    );
  });

  it("reads the requested month and the three previous months for carry-over", async () => {
    const { service, repo } = build("2026-11-21T12:00:00.000Z");

    const view = await service.getSummary(USER_ID, "2026-02");

    expect(view.monthStart).toBe("2026-02-01");
    expect(view.monthEnd).toBe("2026-02-28");
    expect(view.overdueLookbackFrom).toBe("2025-11");
    expect(repo.findMonthRows).toHaveBeenCalledWith(
      USER_ID,
      "2026-02-01",
      "2026-02-28",
    );
    expect(repo.findPayableRows).toHaveBeenCalledWith(
      USER_ID,
      "2025-11-01",
      "2026-01-31",
    );
  });

  it("looks up paid markers for the keys of both row sets, scoped to the user", async () => {
    const { service, repo } = build("2026-11-21T12:00:00.000Z", {
      monthRows: [recurringRow(TXN_ID, "2026-11-10")],
      payableRows: [recurringRow(OLD_TXN_ID, "2026-09-10")],
    });

    const view = await service.getSummary(USER_ID);

    expect(repo.findPaidKeys).toHaveBeenCalledWith(USER_ID, [
      `txn:${TXN_ID}`,
      `txn:${OLD_TXN_ID}`,
    ]);
    expect(
      view.dueItems.map((i) => [i.targetKey, i.status, i.carriedOver]),
    ).toEqual([
      [`txn:${OLD_TXN_ID}`, "OVERDUE", true],
      [`txn:${TXN_ID}`, "OVERDUE", false],
    ]);
  });

  it("returns a zeroed summary, not an error, for an empty month", async () => {
    const { service } = build("2026-11-21T12:00:00.000Z");

    const view = await service.getSummary(USER_ID);

    expect(view.hasActivity).toBe(false);
    expect(view.currencies[0]?.totalMinor).toBe(0);
  });
});
