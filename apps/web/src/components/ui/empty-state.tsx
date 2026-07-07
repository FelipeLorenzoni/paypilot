import type { ReactNode } from "react";
import styles from "./empty-state.module.css";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

/** First-class empty state: guidance plus an optional primary action. */
export function EmptyState({
  title,
  description,
  action,
}: EmptyStateProps): ReactNode {
  return (
    <div className={styles.empty}>
      <p className={styles.title}>{title}</p>
      {description ? <p className={styles.description}>{description}</p> : null}
      {action}
    </div>
  );
}
