"use client";

import { useState, type ReactNode } from "react";
import type { SetBillPaymentRequest } from "@paypilot/shared";
import { Button } from "../../components/ui/button";
import { FormError } from "../../components/ui/form-error";
import { setBillPayment } from "../../lib/api/bill-payments";
import { useApiMutation } from "../../lib/api/hooks";
import styles from "./payment-action.module.css";

export type PaymentTarget = Omit<SetBillPaymentRequest, "paid" | "paidOn">;

export interface PaymentActionProps {
  target: PaymentTarget;
  /** Paid state as reported by the backend. */
  paid: boolean;
  /** Item description, used in the controls' accessible names. */
  label: string;
  /** Latest selectable payment date (the backend's "today"), when known. */
  maxDate?: string;
  /** Refetch the page's data after a successful change. */
  onChanged: () => Promise<boolean>;
}

/**
 * "Mark as paid" (with an optional earlier payment date) or "Undo" for one
 * payable item. Never changes what is shown by itself: on success it asks the
 * page to refetch, so status, totals and order always come from the backend.
 */
export function PaymentAction({
  target,
  paid,
  label,
  maxDate,
  onChanged,
}: PaymentActionProps): ReactNode {
  const mutation = useApiMutation(setBillPayment);
  const [editing, setEditing] = useState(false);
  const [paidOn, setPaidOn] = useState("");

  async function submit(body: SetBillPaymentRequest): Promise<void> {
    const result = await mutation.run(body);
    if (result.ok) {
      setEditing(false);
      setPaidOn("");
      await onChanged();
    }
  }

  const error = mutation.error ? (
    <FormError
      message="Could not save the payment. Please try again."
      requestId={mutation.error.requestId}
    />
  ) : null;

  if (paid) {
    return (
      <div className={styles.action}>
        <Button
          variant="secondary"
          pending={mutation.pending}
          aria-label={`Undo payment for ${label}`}
          onClick={() => void submit({ ...target, paid: false })}
        >
          {mutation.pending ? "Saving…" : "Undo"}
        </Button>
        {error}
      </div>
    );
  }

  if (!editing) {
    return (
      <div className={styles.action}>
        <Button
          variant="secondary"
          aria-label={`Mark ${label} as paid`}
          onClick={() => setEditing(true)}
        >
          Mark as paid
        </Button>
      </div>
    );
  }

  const inputId = `paid-on-${target.transactionId ?? `${target.creditCardId}-${target.invoiceCycle}`}`;
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void submit({
          ...target,
          paid: true,
          ...(paidOn ? { paidOn } : {}),
        });
      }}
    >
      <label htmlFor={inputId} className={styles.label}>
        Payment date (optional, defaults to today)
      </label>
      <input
        id={inputId}
        type="date"
        className={styles.date}
        value={paidOn}
        max={maxDate}
        onChange={(event) => setPaidOn(event.target.value)}
      />
      <div className={styles.buttons}>
        <Button
          type="submit"
          pending={mutation.pending}
          aria-label={`Confirm payment for ${label}`}
        >
          {mutation.pending ? "Saving…" : "Confirm"}
        </Button>
        <Button
          variant="secondary"
          disabled={mutation.pending}
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
      </div>
      {error}
    </form>
  );
}
