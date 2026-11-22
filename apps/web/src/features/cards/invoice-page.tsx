"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { InvoiceTransactionView } from "@paypilot/shared";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { Loading } from "../../components/ui/loading";
import { Table } from "../../components/ui/table";
import { useApiQuery } from "../../lib/api/hooks";
import { getInvoice } from "../../lib/api/cards";
import { formatDate, formatMoney } from "../../lib/format";
import { PaymentAction } from "../bill-payments/payment-action";
import styles from "./invoice-page.module.css";

const COLUMNS = [
  {
    header: "Description",
    render: (row: InvoiceTransactionView) => row.description,
  },
  {
    header: "Installment",
    render: (row: InvoiceTransactionView) =>
      `${row.installmentSeq}/${row.installmentTotal}`,
  },
  {
    header: "Category",
    render: (row: InvoiceTransactionView) => row.category ?? "—",
  },
  {
    header: "Amount",
    render: (row: InvoiceTransactionView) =>
      formatMoney(row.amountMinor, "BRL"),
  },
];

export function InvoicePage({
  cardId,
  cycle,
}: {
  cardId: string;
  cycle: string;
}): ReactNode {
  const state = useApiQuery(() => getInvoice(cardId, cycle), [cardId, cycle]);

  return (
    <div>
      <Link className={styles.back} href="/cards">
        ← Back to cards
      </Link>
      <h1>Invoice {cycle}</h1>
      {state.status === "loading" ? <Loading /> : null}
      {state.status === "error" ? (
        state.error.code === "NOT_FOUND" ? (
          <EmptyState
            title="No invoice for this cycle"
            description="There are no charges assigned to this card in this cycle. Pick another cycle on the cards page."
          />
        ) : (
          <ErrorState
            message="Could not load this invoice."
            requestId={state.error.requestId}
            onRetry={state.retry}
          />
        )
      ) : null}
      {state.status === "loaded" ? (
        <>
          <div className={styles.meta}>
            <p className={styles.metaItem}>
              <span className={styles.metaLabel}>Due date</span>
              <span className={styles.metaValue}>
                {formatDate(state.data.dueDate)}
              </span>
            </p>
            <p className={styles.metaItem}>
              <span className={styles.metaLabel}>Total</span>
              <span className={styles.metaValue}>
                {formatMoney(state.data.totalMinor, "BRL")}
              </span>
            </p>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Payment</span>
              <span className={styles.metaValue}>
                {state.data.paid && state.data.paidOn
                  ? `Paid on ${formatDate(state.data.paidOn)}`
                  : "Not paid"}
              </span>
              <PaymentAction
                target={{
                  targetType: "CARD_INVOICE",
                  creditCardId: cardId,
                  invoiceCycle: cycle,
                }}
                paid={state.data.paid}
                label={`invoice ${cycle}`}
                onChanged={state.refresh}
              />
            </div>
          </div>
          {state.data.transactions.length > 0 ? (
            <Table
              caption={`Invoice ${cycle} transactions`}
              columns={COLUMNS}
              rows={state.data.transactions}
              rowKey={(row) => row.id}
            />
          ) : (
            <EmptyState title="No transactions in this cycle" />
          )}
        </>
      ) : null}
    </div>
  );
}
