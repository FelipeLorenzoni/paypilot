"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { MonthlySummaryView } from "@paypilot/shared";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { Loading } from "../../components/ui/loading";
import { getMonthlySummary } from "../../lib/api/dashboard";
import { useApiQuery } from "../../lib/api/hooks";
import { formatMonth } from "../../lib/format";
import { CategoryBreakdown } from "./category-breakdown";
import { DueItemsList } from "./due-items-list";
import { DueSummaryPanel } from "./due-summary-panel";
import { TotalsPanel } from "./totals-panel";
import styles from "./dashboard-page.module.css";

/**
 * Monthly overview: totals, bills status, categories and due items. A pure
 * rendering of the backend summary — no financial arithmetic here.
 */
export function DashboardPage(): ReactNode {
  // No `isEmpty`: an inactive month can still carry overdue bills from earlier
  // months, which must stay visible next to the empty state.
  const state = useApiQuery(() => getMonthlySummary(), []);

  if (state.status === "loading") {
    return <Loading />;
  }
  if (state.status === "error") {
    return (
      <ErrorState
        message="Could not load the monthly summary."
        requestId={state.error.requestId}
        onRetry={state.retry}
      />
    );
  }
  if (state.status === "empty") {
    return null;
  }
  return <Summary data={state.data} refresh={state.refresh} />;
}

function Summary({
  data,
  refresh,
}: {
  data: MonthlySummaryView;
  refresh: () => Promise<boolean>;
}): ReactNode {
  const hasBills = data.dueItems.length > 0;
  const bills = (
    <>
      <h2 className={styles.sectionTitle}>Bills</h2>
      <DueItemsList
        items={data.dueItems}
        today={data.today}
        onChanged={refresh}
      />
    </>
  );
  return (
    <div>
      <h1 className={styles.month}>{formatMonth(data.month)}</h1>
      {data.hasActivity ? (
        <>
          <div className={styles.panels}>
            {data.currencies.map((summary) => (
              <TotalsPanel
                key={summary.currency}
                summary={summary}
                showCurrency={data.currencies.length > 1}
              />
            ))}
            {hasBills ? <DueSummaryPanel totals={data.dueTotals} /> : null}
          </div>
          {bills}
          <h2 className={styles.sectionTitle}>Categories</h2>
          {data.currencies.map((summary) => (
            <CategoryBreakdown
              key={summary.currency}
              categories={summary.byCategory}
            />
          ))}
        </>
      ) : (
        <>
          <EmptyState
            title={`Nothing recorded for ${formatMonth(data.month)} yet`}
            description="Add an expense, set up a recurring bill or import a statement to see your monthly summary."
            action={
              <Link className={styles.primaryAction} href="/expenses">
                Add an expense
              </Link>
            }
          />
          {hasBills ? (
            <>
              <DueSummaryPanel totals={data.dueTotals} />
              {bills}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
