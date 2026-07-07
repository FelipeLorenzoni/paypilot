"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { LoginForm } from "./login-form";
import { PublicOnly } from "./public-only";
import styles from "./auth-form.module.css";

export function LoginPage(): ReactNode {
  const searchParams = useSearchParams();
  const justRegistered = searchParams.get("registered") === "1";

  return (
    <PublicOnly>
      {justRegistered ? (
        <p className={styles.info} role="status">
          Account created. Please log in.
        </p>
      ) : null}
      <LoginForm />
      <p className={styles.switch}>
        No account yet? <Link href="/register">Create one</Link>
      </p>
    </PublicOnly>
  );
}
