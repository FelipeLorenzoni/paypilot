"use client";

import { useId, useState, type ReactNode } from "react";
import type { RecurringBillView } from "@paypilot/shared";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { Loading } from "../../components/ui/loading";
import { Pagination } from "../../components/ui/pagination";
import { Table } from "../../components/ui/table";
import { useApiQuery } from "../../lib/api/hooks";
import { listRecurringBills } from "../../lib/api/bills";
import { formatMoney } from "../../lib/format";
import styles from "./bills-page.module.css";

const PAGE_SIZE = 20;

type ActiveFilter = "all" | "active" | "inactive";

const COLUMNS = [
  {
    header: "Description",
    render: (row: RecurringBillView) => row.description,
  },
  {
    header: "Amount",
    render: (row: RecurringBillView) => formatMoney(row.amountMinor, "BRL"),
  },
  {
    header: "Day of month",
    render: (row: RecurringBillView) => String(row.dayOfMonth),
  },
  {
    header: "Status",
    render: (row: RecurringBillView) =>
      row.isActive ? (
        <span className={styles.badgeActive}>Active</span>
      ) : (
        <span className={styles.badgeInactive}>Inactive</span>
      ),
  },
];

export function BillsPage(): ReactNode {
  const filterId = useId();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<ActiveFilter>("all");
  const active = filter === "all" ? undefined : filter === "active";

  const state = useApiQuery(
    () => listRecurringBills({ page, pageSize: PAGE_SIZE, active }),
    [page, filter],
    (result) => result.data.length === 0 && result.meta.total === 0,
  );

  return (
    <div>
      <h1>Recurring bills</h1>
      <div className={styles.filter}>
        <label htmlFor={filterId}>Status</label>
        <select
          id={filterId}
          className={styles.select}
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value as ActiveFilter);
            setPage(1);
          }}
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      {state.status === "loading" ? <Loading /> : null}
      {state.status === "error" ? (
        <ErrorState
          message="Could not load your recurring bills."
          requestId={state.error.requestId}
          onRetry={state.retry}
        />
      ) : null}
      {state.status === "empty" ? (
        <EmptyState
          title="No recurring bills yet"
          description="Recurring bills you create will show up here."
        />
      ) : null}
      {state.status === "loaded" ? (
        <>
          <Table
            caption="Recurring bills"
            columns={COLUMNS}
            rows={state.data.data}
            rowKey={(row) => row.id}
          />
          <Pagination
            page={state.data.meta.page}
            pageSize={state.data.meta.pageSize}
            total={state.data.meta.total}
            onPageChange={setPage}
          />
        </>
      ) : null}
    </div>
  );
}
