import { GenerationService } from "./generation.service";
import type { RecurringBillsRepository } from "./recurring-bills.repository";

interface BillRow {
  id: string;
  userId: string;
  amountMinor: bigint;
  currency: string;
  dayOfMonth: number;
  description: string;
  categoryLabel: string | null;
  startDate: Date;
  endDate: Date | null;
}

const bill = (overrides: Partial<BillRow> = {}): BillRow => ({
  id: "bill-1",
  userId: "user-1",
  amountMinor: 5000n,
  currency: "BRL",
  dayOfMonth: 10,
  description: "Rent",
  categoryLabel: "Housing",
  startDate: new Date("2026-01-01T00:00:00.000Z"),
  endDate: null,
  ...overrides,
});

function build(bills: BillRow[], createImpl?: jest.Mock) {
  const create = createImpl ?? jest.fn().mockResolvedValue({});
  const prisma = { transaction: { create } } as unknown as never;
  const repo = {
    findActiveForGeneration: jest.fn().mockResolvedValue(bills),
  } as unknown as RecurringBillsRepository;
  const service = new GenerationService(prisma, repo);
  return { service, create };
}

describe("GenerationService.generateForPeriod", () => {
  it("creates one snapshot transaction per eligible bill", async () => {
    const { service, create } = build([bill()]);
    const summary = await service.generateForPeriod("2026-03");

    expect(summary).toEqual({
      period: "2026-03",
      created: 1,
      skipped: 0,
      failed: 0,
    });
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: "user-1",
      type: "EXPENSE",
      source: "RECURRING",
      recurringBillId: "bill-1",
      periodKey: "2026-03",
      amountMinor: 5000n,
      currency: "BRL",
      description: "Rent",
      categoryLabel: "Housing",
    });
    expect(data.transactionDate.toISOString()).toBe("2026-03-10T00:00:00.000Z");
  });

  it("clamps the day for short months", async () => {
    const { service, create } = build([bill({ dayOfMonth: 31 })]);
    await service.generateForPeriod("2026-02");
    expect(create.mock.calls[0][0].data.transactionDate.toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });

  it("skips bills outside their eligibility window (zero generated)", async () => {
    const { service, create } = build([
      bill({ startDate: new Date("2026-05-01T00:00:00.000Z") }),
      bill({ id: "b2", endDate: new Date("2026-01-31T00:00:00.000Z") }),
    ]);
    const summary = await service.generateForPeriod("2026-03");
    expect(summary.created).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it("treats a P2002 unique violation as already-generated (skip, no throw)", async () => {
    const create = jest.fn().mockRejectedValue({ code: "P2002" });
    const { service } = build([bill()], create);
    const summary = await service.generateForPeriod("2026-03");
    expect(summary).toEqual({
      period: "2026-03",
      created: 0,
      skipped: 1,
      failed: 0,
    });
  });

  it("counts non-unique errors as failed without aborting the run", async () => {
    const create = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({});
    const { service } = build([bill({ id: "b1" }), bill({ id: "b2" })], create);
    const summary = await service.generateForPeriod("2026-03");
    expect(summary).toEqual({
      period: "2026-03",
      created: 1,
      skipped: 0,
      failed: 1,
    });
  });
});
