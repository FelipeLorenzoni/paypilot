import type { ReactNode } from "react";
import styles from "./form-error.module.css";

export interface FormErrorProps {
  message: string | null;
  requestId?: string | null;
}

/** Form-level failure, announced to assistive tech via `role="alert"`. */
export function FormError({ message, requestId }: FormErrorProps): ReactNode {
  if (!message) {
    return null;
  }
  return (
    <div role="alert" className={styles.alert}>
      {message}
      {requestId ? (
        <span className={styles.requestId}>Request ID: {requestId}</span>
      ) : null}
    </div>
  );
}
