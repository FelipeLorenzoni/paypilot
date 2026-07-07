"use client";

import type { ReactNode } from "react";
import { Button } from "./button";
import styles from "./error-state.module.css";

export interface ErrorStateProps {
  message: string;
  requestId: string | null;
  onRetry?: () => void;
}

/** Request-level failure: message + requestId for support + optional retry. */
export function ErrorState({
  message,
  requestId,
  onRetry,
}: ErrorStateProps): ReactNode {
  return (
    <div role="alert" className={styles.error}>
      <p className={styles.message}>{message}</p>
      {requestId ? (
        <p className={styles.requestId}>Request ID: {requestId}</p>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
