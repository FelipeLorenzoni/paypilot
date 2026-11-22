import type { LedgerRow, PaidMarker } from "./summarize-month";
import { payableTargetKeys, summarizeMonth } from "./summarize-month";

const CARD_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CARD_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let seq = 0;

/** Deterministic UUID per call — row ids double as recurring target keys. */
function nextId(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

function row(overrides: Partial<LedgerRow>): LedgerRow {
  return {
    id: nextId(),
    source: "MANUAL",
    amountMinor: 1000n,
    currency: "BRL",
    transactionDate: "2026-11-15",
    description: "row",
    categoryLabel: null,
    creditCardId: null,
    creditCardLabel: null,
    invoiceCycle: null,
    ...overrides,
  };
}

function cardRow(
  cardId: string,
  cycle: string,
  dueDate: string,
  amountMinor: bigint,
): LedgerRow {
  return row({
    source: "CARD",
    creditCardId: cardId,
    creditCardLabel: cardId === CARD_A ? "Nubank" : "Inter",
    invoiceCycle: cycle,
    transactionDate: dueDate,
    amountMinor,
  });
}

function summarize(
  rows: LedgerRow[],
  opts: {
    carryOverRows?: LedgerRow[];
    markers?: PaidMarker[];
  } = {},
) {
  return summarizeMonth({
    month: "2026-11",
    monthStart: "2026-11-01",
    monthEnd: "2026-11-30",
    today: "2026-11-21",
    rows,
    carryOverRows: opts.carryOverRows ?? [],
    markers: opts.markers ?? [],
  });
}

function recurring(dueDate: string, overrides: Partial<LedgerRow> = {}) {
  return row({ source: "RECURRING", transactionDate: dueDate, ...overrides });
}

const ZERO_SOURCES = [
  { source: "MANUAL", amountMinor: 0 },
  { source: "RECURRING", amountMinor: 0 },
  { source: "CARD", amountMinor: 0 },
  { source: "IMPORTED", amountMinor: 0 },
];

describe("summarizeMonth — totals and sources", () => {
  it("sums all four sources into one total with per-source subtotals", () => {
    const view = summarize([
      row({ source: "MANUAL", amountMinor: 1050n }),
      recurring("2026-11-25", { amountMinor: 20000n }),
      cardRow(CARD_A, "2026-10", "2026-11-10", 3333n),
      row({ source: "IMPORTED", amountMinor: 17n }),
    ]);

    expect(view.hasActivity).toBe(true);
    expect(view.currencies).toEqual([
      expect.objectContaining({
        currency: "BRL",
        totalMinor: 24400,
        bySource: [
          { source: "MANUAL", amountMinor: 1050 },
          { source: "RECURRING", amountMinor: 20000 },
          { source: "CARD", amountMinor: 3333 },
          { source: "IMPORTED", amountMinor: 17 },
        ],
      }),
    ]);
  });

  it("reports an absent source as a zero entry, not a missing one", () => {
    const view = summarize([row({ source: "MANUAL", amountMinor: 500n })]);

    expect(view.currencies[0]?.bySource).toEqual([
      { source: "MANUAL", amountMinor: 500 },
      ...ZERO_SOURCES.slice(1),
    ]);
  });

  it("keeps currencies in separate blocks and never sums across them", () => {
    const view = summarize([
      row({ amountMinor: 101n, currency: "BRL" }),
      row({ amountMinor: 202n, currency: "USD" }),
      row({ amountMinor: 303n, currency: "BRL" }),
    ]);

    expect(view.currencies.map((c) => [c.currency, c.totalMinor])).toEqual([
      ["BRL", 404],
      ["USD", 202],
    ]);
  });

  it("returns a zeroed BRL block with no activity for an empty month", () => {
    const view = summarize([]);

    expect(view.hasActivity).toBe(false);
    expect(view.currencies).toEqual([
      {
        currency: "BRL",
        totalMinor: 0,
        bySource: ZERO_SOURCES,
        byCategory: [],
      },
    ]);
    expect(view.dueItems).toEqual([]);
    expect(view.dueTotals).toEqual([]);
  });

  it("echoes the month boundaries, today and the look-back start", () => {
    expect(summarize([])).toEqual(
      expect.objectContaining({
        month: "2026-11",
        monthStart: "2026-11-01",
        monthEnd: "2026-11-30",
        today: "2026-11-21",
        overdueLookbackFrom: "2026-08",
      }),
    );
  });

  it("rejects an amount beyond the safe integer range", () => {
    expect(() =>
      summarize([row({ amountMinor: BigInt(Number.MAX_SAFE_INTEGER) + 1n })]),
    ).toThrow(/safe integer/);
  });
});

describe("summarizeMonth — categories", () => {
  it("collapses null labels into one bucket, amount descending then label", () => {
    const view = summarize([
      row({ categoryLabel: "Food", amountMinor: 300n }),
      row({ categoryLabel: null, amountMinor: 200n }),
      row({ categoryLabel: "Bills", amountMinor: 500n }),
      row({ categoryLabel: null, amountMinor: 100n }),
      row({ categoryLabel: "Auto", amountMinor: 300n }),
    ]);

    expect(view.currencies[0]?.byCategory).toEqual([
      { label: "Bills", amountMinor: 500 },
      { label: "Auto", amountMinor: 300 },
      { label: "Food", amountMinor: 300 },
      { label: null, amountMinor: 300 },
    ]);
  });
});

describe("summarizeMonth — due items", () => {
  it("collapses the rows of one card invoice into one item; manual and imported rows produce none", () => {
    const view = summarize([
      cardRow(CARD_A, "2026-11", "2026-11-28", 1500n),
      cardRow(CARD_A, "2026-11", "2026-11-28", 2500n),
      row({ source: "MANUAL" }),
      row({ source: "IMPORTED" }),
    ]);

    expect(view.dueItems).toEqual([
      {
        targetType: "CARD_INVOICE",
        targetKey: `card:${CARD_A}:2026-11`,
        source: "CARD",
        description: "Nubank",
        dueDate: "2026-11-28",
        amountMinor: 4000,
        currency: "BRL",
        status: "DUE",
        paidAt: null,
        paidOn: null,
        transactionId: null,
        creditCardId: CARD_A,
        invoiceCycle: "2026-11",
        carriedOver: false,
      },
    ]);
  });

  it("lists an unpaid month item due before today as OVERDUE", () => {
    const bill = recurring("2026-11-10", {
      description: "Condominium",
      amountMinor: 85048n,
    });

    expect(summarize([bill]).dueItems).toEqual([
      expect.objectContaining({
        targetType: "RECURRING_TRANSACTION",
        targetKey: `txn:${bill.id}`,
        source: "RECURRING",
        description: "Condominium",
        amountMinor: 85048,
        status: "OVERDUE",
        paidAt: null,
        paidOn: null,
        transactionId: bill.id,
        creditCardId: null,
        invoiceCycle: null,
        carriedOver: false,
      }),
    ]);
  });

  it("keeps a paid item listed as PAID with its paid timestamp", () => {
    const bill = recurring("2026-11-05");
    const view = summarize([bill], {
      markers: [
        {
          targetKey: `txn:${bill.id}`,
          paidAt: "2026-11-04T13:00:00.000Z",
          paidOn: "2026-11-03",
        },
      ],
    });

    expect(view.dueItems).toEqual([
      expect.objectContaining({
        status: "PAID",
        paidAt: "2026-11-04T13:00:00.000Z",
        paidOn: "2026-11-03",
      }),
    ]);
  });

  it("orders by status OVERDUE, DUE, PAID, then due date, then target key", () => {
    const paid = recurring("2026-11-01");
    const due = recurring("2026-11-25");
    const overdueLate = recurring("2026-11-20");
    const overdueEarly = recurring("2026-11-02");
    const rows = [
      paid,
      due,
      overdueLate,
      overdueEarly,
      cardRow(CARD_B, "2026-11", "2026-11-25", 1n),
      cardRow(CARD_A, "2026-11", "2026-11-25", 1n),
    ];
    const markers = [
      {
        targetKey: `txn:${paid.id}`,
        paidAt: "2026-11-01T10:00:00.000Z",
        paidOn: "2026-11-01",
      },
    ];
    const keysOf = (input: LedgerRow[]) =>
      summarize(input, { markers }).dueItems.map((i) => i.targetKey);

    const keys = keysOf(rows);

    expect(keys).toEqual([
      `txn:${overdueEarly.id}`,
      `txn:${overdueLate.id}`,
      `card:${CARD_A}:2026-11`,
      `card:${CARD_B}:2026-11`,
      `txn:${due.id}`,
      `txn:${paid.id}`,
    ]);
    // Deterministic for identical inputs in any order.
    expect(keysOf([...rows].reverse())).toEqual(keys);
  });

  it("computes overdue and due counts and amounts per currency, never across them", () => {
    const view = summarize([
      recurring("2026-11-10", { amountMinor: 1000n }),
      recurring("2026-11-12", { amountMinor: 250n }),
      recurring("2026-11-25", { amountMinor: 700n }),
      recurring("2026-11-10", { amountMinor: 99n, currency: "USD" }),
    ]);

    expect(view.dueTotals).toEqual([
      {
        currency: "BRL",
        overdueCount: 2,
        overdueMinor: 1250,
        dueCount: 1,
        dueMinor: 700,
      },
      {
        currency: "USD",
        overdueCount: 1,
        overdueMinor: 99,
        dueCount: 0,
        dueMinor: 0,
      },
    ]);
  });
});

describe("summarizeMonth — carry-over from the look-back window", () => {
  it("lists an unpaid look-back item as OVERDUE and carried over, and drops a paid one", () => {
    const unpaid = recurring("2026-09-10", { amountMinor: 1168n });
    const paid = recurring("2026-10-10");
    const view = summarize([], {
      carryOverRows: [
        unpaid,
        paid,
        cardRow(CARD_A, "2026-09", "2026-10-05", 400n),
        cardRow(CARD_A, "2026-09", "2026-10-05", 600n),
      ],
      markers: [
        {
          targetKey: `txn:${paid.id}`,
          paidAt: "2026-10-09T12:00:00.000Z",
          paidOn: "2026-10-09",
        },
      ],
    });

    expect(view.dueItems).toEqual([
      expect.objectContaining({
        targetKey: `txn:${unpaid.id}`,
        status: "OVERDUE",
        carriedOver: true,
        amountMinor: 1168,
      }),
      expect.objectContaining({
        targetKey: `card:${CARD_A}:2026-09`,
        status: "OVERDUE",
        carriedOver: true,
        amountMinor: 1000,
      }),
    ]);
    expect(view.dueTotals).toEqual([
      {
        currency: "BRL",
        overdueCount: 2,
        overdueMinor: 2168,
        dueCount: 0,
        dueMinor: 0,
      },
    ]);
  });

  it("never changes the month's totals, categories or activity flag", () => {
    const monthRows = [
      row({ source: "MANUAL", amountMinor: 500n, categoryLabel: "Food" }),
    ];
    const carryOverRows = [
      recurring("2026-08-11", {
        amountMinor: 9999n,
        categoryLabel: "Gas",
        currency: "USD",
      }),
    ];

    const withCarry = summarize(monthRows, { carryOverRows });
    const onlyCarry = summarize([], { carryOverRows });

    expect(withCarry.currencies).toEqual(summarize(monthRows).currencies);
    expect(withCarry.hasActivity).toBe(true);
    expect(onlyCarry.hasActivity).toBe(false);
    expect(onlyCarry.currencies).toEqual(summarize([]).currencies);
    expect(onlyCarry.dueItems).toHaveLength(1);
  });

  it("puts carried-over items before the month's overdue items by due date", () => {
    const old = recurring("2026-10-10");
    const current = recurring("2026-11-10");

    const keys = summarize([current], { carryOverRows: [old] }).dueItems.map(
      (i) => i.targetKey,
    );

    expect(keys).toEqual([`txn:${old.id}`, `txn:${current.id}`]);
  });
});

describe("payableTargetKeys", () => {
  it("derives one key per recurring row and per card invoice, none for manual or imported rows", () => {
    const bill = recurring("2026-11-10");

    expect(
      payableTargetKeys([
        bill,
        cardRow(CARD_A, "2026-11", "2026-11-28", 1n),
        cardRow(CARD_A, "2026-11", "2026-11-28", 2n),
        row({ source: "MANUAL" }),
        row({ source: "IMPORTED" }),
      ]),
    ).toEqual([`txn:${bill.id}`, `card:${CARD_A}:2026-11`]);
  });
});
