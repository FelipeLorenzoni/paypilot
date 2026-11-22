import type { ReactNode } from "react";
import type { CurrencySummary, SummarySource } from "@paypilot/shared";
import { formatMoney } from "../../lib/format";
import styles from "./dashboard-page.module.css";

const SOURCE_LABELS: Record<SummarySource, string> = {
  MANUAL: "Manual expenses",
  RECURRING: "Recurring bills",
  CARD: "Card invoices",
  IMPORTED: "Imported",
};

/** Monthly total and the four source subtotals of one currency block. */
export function TotalsPanel({
  summary,
  showCurrency,
}: {
  summary: CurrencySummary;
  showCurrency: boolean;
}): ReactNode {
  const headingId = `totals-${summary.currency}`;
  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.panelTitle}>
        Monthly total{showCurrency ? ` (${summary.currency})` : ""}
      </h2>
      <p className={styles.total}>{formatMoney(summary.totalMinor, "BRL")}</p>
      <dl className={styles.sources}>
        {summary.bySource.map((entry) => (
          <div key={entry.source} className={styles.sourceRow}>
            <dt>{SOURCE_LABELS[entry.source]}</dt>
            <dd>{formatMoney(entry.amountMinor, "BRL")}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.note}>
        Card invoices count in the month they are due, not the month of the
        purchase.
      </p>
    </section>
  );
}
