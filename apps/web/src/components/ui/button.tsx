"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./button.module.css";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pending?: boolean;
  variant?: "primary" | "secondary";
}

/** Button with a pending state (disabled + `aria-busy` while an action runs). */
export function Button({
  pending = false,
  variant = "primary",
  disabled,
  children,
  ...rest
}: ButtonProps): ReactNode {
  return (
    <button
      type={rest.type ?? "button"}
      {...rest}
      className={
        variant === "secondary"
          ? `${styles.button} ${styles.secondary}`
          : styles.button
      }
      disabled={disabled || pending}
      aria-busy={pending || undefined}
    >
      {children}
    </button>
  );
}
