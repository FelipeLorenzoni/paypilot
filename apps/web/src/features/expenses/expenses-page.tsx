"use client";

import { useState, type ReactNode } from "react";
import type { ExpenseView } from "@paypilot/shared";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { Loading } from "../../components/ui/loading";
import { Pagination } from "../../components/ui/pagination";
import { Table } from "../../components/ui/table";
import { useApiQuery } from "../../lib/api/hooks";
import { listExpenses } from "../../lib/api/expenses";
import { formatDate, formatMoney } from "../../lib/format";

const PAGE_SIZE = 20;

const COLUMNS = [
  { header: "Date", render: (row: ExpenseView) => formatDate(row.expenseDate) },
  { header: "Description", render: (row: ExpenseView) => row.description },
  { header: "Category", render: (row: ExpenseView) => row.category ?? "—" },
  {
    header: "Amount",
    render: (row: ExpenseView) => formatMoney(row.amountMinor, "BRL"),
  },
];

export function ExpensesPage(): ReactNode {
  const [page, setPage] = useState(1);
  const state = useApiQuery(
    () => listExpenses({ page, pageSize: PAGE_SIZE }),
    [page],
    (result) => result.data.length === 0 && result.meta.total === 0,
  );

  return (
    <div>
      <h1>Expenses</h1>
      {state.status === "loading" ? <Loading /> : null}
      {state.status === "error" ? (
        <ErrorState
          message="Could not load your expenses."
          requestId={state.error.requestId}
          onRetry={state.retry}
        />
      ) : null}
      {state.status === "empty" ? (
        <EmptyState
          title="No expenses yet"
          description="Expenses you add or import will show up here."
        />
      ) : null}
      {state.status === "loaded" ? (
        <>
          <Table
            caption="Expenses"
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
