import type { ReactNode } from "react";
import type { DueItemView, DueStatus } from "@paypilot/shared";
import { EmptyState } from "../../components/ui/empty-state";
import { Table, type TableColumn } from "../../components/ui/table";
import { formatDate, formatMoney } from "../../lib/format";
import {
  PaymentAction,
  type PaymentTarget,
} from "../bill-payments/payment-action";
import styles from "./dashboard-page.module.css";

const STATUS_LABELS: Record<DueStatus, string> = {
  OVERDUE: "Overdue",
  DUE: "Due",
  PAID: "Paid",
};

const STATUS_CLASSES: Record<DueStatus, string | undefined> = {
  OVERDUE: styles.statusOverdue,
  DUE: styles.statusDue,
  PAID: styles.statusPaid,
};

/** The validated identity parts the backend derives the key from. */
function paymentTarget(item: DueItemView): PaymentTarget {
  return item.source === "CARD"
    ? {
        targetType: "CARD_INVOICE",
        creditCardId: item.creditCardId ?? undefined,
        invoiceCycle: item.invoiceCycle ?? undefined,
      }
    : {
        targetType: "RECURRING_TRANSACTION",
        transactionId: item.transactionId ?? undefined,
      };
}

const BASE_COLUMNS: Array<TableColumn<DueItemView>> = [
  {
    header: "Description",
    render: (row) => (
      <>
        {row.description}
        {row.carriedOver ? (
          <span className={styles.carriedOver}>From an earlier month</span>
        ) : null}
      </>
    ),
  },
  {
    header: "Source",
    render: (row) =>
      row.source === "CARD" ? "Card invoice" : "Recurring bill",
  },
  {
    header: "Due date",
    render: (row) => formatDate(row.dueDate),
  },
  {
    header: "Amount",
    render: (row) => formatMoney(row.amountMinor, "BRL"),
  },
  {
    header: "Status",
    // Text badge — the colour only reinforces it, never replaces it.
    render: (row) => (
      <>
        <span
          data-testid="due-status"
          className={`${styles.status} ${STATUS_CLASSES[row.status] ?? ""}`}
        >
          {STATUS_LABELS[row.status]}
        </span>
        {row.paidOn ? (
          <span className={styles.paidOn}>on {formatDate(row.paidOn)}</span>
        ) : null}
      </>
    ),
  },
];

/**
 * Due items in the order received (overdue → due → paid), each with its
 * mark/undo action. Status and paid state come from the backend; nothing here
 * compares dates.
 */
export function DueItemsList({
  items,
  today,
  onChanged,
}: {
  items: DueItemView[];
  /** Backend "today", the latest selectable payment date. */
  today: string;
  /** Refetch the summary after a payment change. */
  onChanged: () => Promise<boolean>;
}): ReactNode {
  if (items.length === 0) {
    return <EmptyState title="No bills this month" />;
  }
  const columns: Array<TableColumn<DueItemView>> = [
    ...BASE_COLUMNS,
    {
      header: "Actions",
      render: (row) => (
        <PaymentAction
          target={paymentTarget(row)}
          paid={row.status === "PAID"}
          // The due date tells apart same-named bills (e.g. two months of rent).
          label={`${row.description} due ${formatDate(row.dueDate)}`}
          maxDate={today}
          onChanged={onChanged}
        />
      ),
    },
  ];
  return (
    <Table
      caption="Bills of the month"
      columns={columns}
      rows={items}
      rowKey={(row) => row.targetKey}
    />
  );
}
