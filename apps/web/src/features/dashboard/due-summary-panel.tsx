import type { ReactNode } from "react";
import type { DueTotals } from "@paypilot/shared";
import { formatMoney } from "../../lib/format";
import styles from "./dashboard-page.module.css";

/** "Overdue" and "Still to pay", exactly as counted by the backend. */
export function DueSummaryPanel({
  totals,
}: {
  totals: DueTotals[];
}): ReactNode {
  return (
    <section className={styles.panel} aria-labelledby="due-summary">
      <h2 id="due-summary" className={styles.panelTitle}>
        Bills status
      </h2>
      {totals.map((entry) => (
        <div key={entry.currency} className={styles.dueSummary}>
          <p className={styles.overdueLine}>
            Overdue: {entry.overdueCount} ·{" "}
            {formatMoney(entry.overdueMinor, "BRL")}
          </p>
          <p className={styles.dueLine}>
            Still to pay: {entry.dueCount} ·{" "}
            {formatMoney(entry.dueMinor, "BRL")}
          </p>
        </div>
      ))}
    </section>
  );
}
