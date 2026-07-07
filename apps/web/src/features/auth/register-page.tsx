"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { PublicOnly } from "./public-only";
import { RegisterForm } from "./register-form";
import styles from "./auth-form.module.css";

export function RegisterPage(): ReactNode {
  return (
    <PublicOnly>
      <RegisterForm />
      <p className={styles.switch}>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </PublicOnly>
  );
}
