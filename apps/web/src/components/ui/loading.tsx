import type { ReactNode } from "react";
import styles from "./loading.module.css";

export interface LoadingProps {
  label?: string;
}

/** Loading indicator announced via `role="status"` + `aria-busy`. */
export function Loading({ label = "Loading…" }: LoadingProps): ReactNode {
  return (
    <div role="status" aria-busy="true" className={styles.loading}>
      {label}
    </div>
  );
}
