"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import type { CreditCardView } from "@paypilot/shared";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { Loading } from "../../components/ui/loading";
import { useApiQuery } from "../../lib/api/hooks";
import { listCreditCards } from "../../lib/api/cards";
import styles from "./cards-page.module.css";

/** Current month as a local `YYYY-MM` string (the default invoice cycle). */
function currentCycle(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

function CardRow({ card }: { card: CreditCardView }): ReactNode {
  const cycleId = useId();
  const [cycle, setCycle] = useState(currentCycle);
  const validCycle = /^\d{4}-\d{2}$/.test(cycle);

  return (
    <li className={styles.card}>
      <span className={styles.label}>{card.label}</span>
      {card.isActive ? null : <span className={styles.inactive}>Inactive</span>}
      <span className={styles.days}>
        Closes on day {card.closingDay}, due on day {card.dueDay}
      </span>
      <span className={styles.picker}>
        <label htmlFor={cycleId}>Invoice cycle</label>
        <input
          id={cycleId}
          className={styles.cycleInput}
          type="month"
          value={cycle}
          onChange={(event) => setCycle(event.target.value)}
        />
        {validCycle ? (
          <Link href={`/cards/${card.id}/invoices/${cycle}`}>View invoice</Link>
        ) : null}
      </span>
    </li>
  );
}

export function CardsPage(): ReactNode {
  const state = useApiQuery(
    () => listCreditCards({ page: 1, pageSize: 100 }),
    [],
    (result) => result.data.length === 0 && result.meta.total === 0,
  );

  return (
    <div>
      <h1>Cards &amp; invoices</h1>
      {state.status === "loading" ? <Loading /> : null}
      {state.status === "error" ? (
        <ErrorState
          message="Could not load your credit cards."
          requestId={state.error.requestId}
          onRetry={state.retry}
        />
      ) : null}
      {state.status === "empty" ? (
        <EmptyState
          title="No credit cards yet"
          description="Credit cards you register will show up here with their invoices."
        />
      ) : null}
      {state.status === "loaded" ? (
        <ul className={styles.list}>
          {state.data.data.map((card) => (
            <CardRow key={card.id} card={card} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
