import type {
  CategorySubtotal,
  CurrencySummary,
  DueItemView,
  DueStatus,
  DueTotals,
  MonthlySummaryView,
  SummarySource,
} from "@paypilot/shared";
import { toAmountNumber } from "../../common/ledger-money-date";
import {
  cardInvoiceTarget,
  recurringTarget,
  type ReminderTarget,
} from "../../reminders/domain/reminder-target";
import { dueStatus } from "./due-status";
import { lookbackFrom } from "./month-range";

/**
 * Pure monthly-summary aggregation (design.md `summarizeMonth`; requirements
 * 2.x–6.x, 8.3, 8.8). Framework- and clock-free: `today` and the month
 * boundaries arrive as date-only strings. Money stays `bigint` in every
 * accumulator and crosses to `number` once, through `toAmountNumber`, when the
 * view is built. Nothing ever sums across currencies.
 */

/** A ledger row as read for the summary — money stays bigint. */
export interface LedgerRow {
  id: string;
  source: SummarySource;
  amountMinor: bigint;
  currency: string;
  transactionDate: string; // YYYY-MM-DD
  description: string;
  categoryLabel: string | null;
  creditCardId: string | null;
  creditCardLabel: string | null;
  invoiceCycle: string | null; // YYYY-MM
}

/** A paid marker, reduced to what the summary needs. */
export interface PaidMarker {
  targetKey: string;
  paidAt: string; // ISO UTC — when the payment was recorded
  paidOn: string; // YYYY-MM-DD — the payment date
}

export interface SummarizeMonthInput {
  month: string; // YYYY-MM
  monthStart: string; // YYYY-MM-DD
  monthEnd: string; // YYYY-MM-DD
  today: string; // YYYY-MM-DD (UTC calendar date of the injected clock)
  rows: readonly LedgerRow[];
  /** RECURRING/CARD rows of the look-back window (before monthStart). */
  carryOverRows: readonly LedgerRow[];
  markers: readonly PaidMarker[];
}

/** Stable `bySource` order; every block always lists all four. */
const SOURCES: readonly SummarySource[] = [
  "MANUAL",
  "RECURRING",
  "CARD",
  "IMPORTED",
];

/** The zeroed block an empty month reports (requirement 2.4). */
const DEFAULT_CURRENCY = "BRL";

const STATUS_RANK: Record<DueStatus, number> = { OVERDUE: 0, DUE: 1, PAID: 2 };

/** A payable item before status/paid state is attached. */
interface PayableItem {
  target: ReminderTarget;
  source: "RECURRING" | "CARD";
  description: string;
  dueDate: string;
  amountMinor: bigint;
  currency: string;
}

interface DueItem extends Omit<DueItemView, "amountMinor"> {
  amountMinor: bigint;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function summarizeCurrency(
  currency: string,
  rows: readonly LedgerRow[],
): CurrencySummary {
  let total = 0n;
  const bySource = new Map<SummarySource, bigint>(SOURCES.map((s) => [s, 0n]));
  const byCategory = new Map<string | null, bigint>();
  for (const row of rows) {
    total += row.amountMinor;
    bySource.set(
      row.source,
      (bySource.get(row.source) ?? 0n) + row.amountMinor,
    );
    byCategory.set(
      row.categoryLabel,
      (byCategory.get(row.categoryLabel) ?? 0n) + row.amountMinor,
    );
  }

  const categories = [...byCategory.entries()].sort(
    ([labelA, a], [labelB, b]) => {
      if (a !== b) return a > b ? -1 : 1;
      // Ties: labels ascending, the uncategorized bucket last.
      if (labelA === null) return 1;
      if (labelB === null) return -1;
      return compareStrings(labelA, labelB);
    },
  );

  return {
    currency,
    totalMinor: toAmountNumber(total),
    bySource: SOURCES.map((source) => ({
      source,
      amountMinor: toAmountNumber(bySource.get(source) ?? 0n),
    })),
    byCategory: categories.map(([label, amount]): CategorySubtotal => ({
      label,
      amountMinor: toAmountNumber(amount),
    })),
  };
}

function summarizeCurrencies(rows: readonly LedgerRow[]): CurrencySummary[] {
  if (rows.length === 0) return [summarizeCurrency(DEFAULT_CURRENCY, [])];
  const byCurrency = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    const bucket = byCurrency.get(row.currency) ?? [];
    bucket.push(row);
    byCurrency.set(row.currency, bucket);
  }
  return [...byCurrency.keys()]
    .sort(compareStrings)
    .map((currency) => summarizeCurrency(currency, byCurrency.get(currency)!));
}

/**
 * One item per RECURRING row and one per card invoice
 * (`creditCardId`, `invoiceCycle`, `currency`) summing its rows. MANUAL and
 * IMPORTED rows are already-incurred spend and never become payable items.
 */
function payableItems(rows: readonly LedgerRow[]): PayableItem[] {
  const items: PayableItem[] = [];
  const invoices = new Map<string, PayableItem>();
  for (const row of rows) {
    if (row.source === "RECURRING") {
      items.push({
        target: recurringTarget(row.id),
        source: "RECURRING",
        description: row.description,
        dueDate: row.transactionDate,
        amountMinor: row.amountMinor,
        currency: row.currency,
      });
    } else if (row.source === "CARD") {
      // Schema CHECK guarantees both are set on CARD rows.
      const target = cardInvoiceTarget(row.creditCardId!, row.invoiceCycle!);
      const key = `${target.targetKey}|${row.currency}`;
      const invoice = invoices.get(key);
      if (invoice) {
        invoice.amountMinor += row.amountMinor;
      } else {
        const created: PayableItem = {
          target,
          source: "CARD",
          description: row.creditCardLabel ?? row.description,
          dueDate: row.transactionDate,
          amountMinor: row.amountMinor,
          currency: row.currency,
        };
        invoices.set(key, created);
        items.push(created);
      }
    }
  }
  return items;
}

/**
 * Canonical target keys of the payable items in `rows` — what the paid-marker
 * lookup is bounded by. Same derivation as the due list, so they cannot drift.
 */
export function payableTargetKeys(rows: readonly LedgerRow[]): string[] {
  return payableItems(rows).map((item) => item.target.targetKey);
}

function toDueItem(
  item: PayableItem,
  today: string,
  markers: Map<string, PaidMarker>,
  carriedOver: boolean,
): DueItem {
  const marker = markers.get(item.target.targetKey);
  return {
    targetType: item.target.targetType,
    targetKey: item.target.targetKey,
    source: item.source,
    description: item.description,
    dueDate: item.dueDate,
    amountMinor: item.amountMinor,
    currency: item.currency,
    status: dueStatus(item.dueDate, today, marker !== undefined),
    paidAt: marker?.paidAt ?? null,
    paidOn: marker?.paidOn ?? null,
    transactionId: item.target.transactionId,
    creditCardId: item.target.creditCardId,
    invoiceCycle: item.target.invoiceCycle,
    carriedOver,
  };
}

function summarizeDue(items: readonly DueItem[]): DueTotals[] {
  const totals = new Map<
    string,
    { overdueCount: number; overdue: bigint; dueCount: number; due: bigint }
  >();
  for (const item of items) {
    const entry = totals.get(item.currency) ?? {
      overdueCount: 0,
      overdue: 0n,
      dueCount: 0,
      due: 0n,
    };
    if (item.status === "OVERDUE") {
      entry.overdueCount += 1;
      entry.overdue += item.amountMinor;
    } else if (item.status === "DUE") {
      entry.dueCount += 1;
      entry.due += item.amountMinor;
    }
    totals.set(item.currency, entry);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([currency, entry]) => ({
      currency,
      overdueCount: entry.overdueCount,
      overdueMinor: toAmountNumber(entry.overdue),
      dueCount: entry.dueCount,
      dueMinor: toAmountNumber(entry.due),
    }));
}

export function summarizeMonth(input: SummarizeMonthInput): MonthlySummaryView {
  const markers = new Map(input.markers.map((m) => [m.targetKey, m]));

  const monthItems = payableItems(input.rows).map((item) =>
    toDueItem(item, input.today, markers, false),
  );
  // Carry-over feeds only the due list, and only while still unpaid.
  const carriedItems = payableItems(input.carryOverRows)
    .map((item) => toDueItem(item, input.today, markers, true))
    .filter((item) => item.status === "OVERDUE");

  const dueItems = [...carriedItems, ...monthItems].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      compareStrings(a.dueDate, b.dueDate) ||
      compareStrings(a.targetKey, b.targetKey),
  );

  return {
    month: input.month,
    monthStart: input.monthStart,
    monthEnd: input.monthEnd,
    today: input.today,
    hasActivity: input.rows.length > 0,
    currencies: summarizeCurrencies(input.rows),
    dueItems: dueItems.map((item) => ({
      ...item,
      amountMinor: toAmountNumber(item.amountMinor),
    })),
    dueTotals: summarizeDue(dueItems),
    overdueLookbackFrom: lookbackFrom(input.month),
  };
}
