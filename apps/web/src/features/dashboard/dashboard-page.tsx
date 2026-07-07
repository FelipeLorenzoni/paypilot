"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAuth } from "../../lib/session/auth-context";
import styles from "./dashboard-page.module.css";

const SHORTCUTS = [
  { href: "/expenses", label: "Expenses" },
  { href: "/bills", label: "Recurring bills" },
  { href: "/cards", label: "Cards & invoices" },
  { href: "/imports", label: "CSV imports" },
  { href: "/reminders", label: "Reminders/settings" },
] as const;

/** Navigable landing only — the real monthly overview is its own spec. */
export function DashboardPage(): ReactNode {
  const { user } = useAuth();
  return (
    <div>
      <h1 className={styles.greeting}>Welcome, {user.email}</h1>
      <ul className={styles.shortcuts}>
        {SHORTCUTS.map((shortcut) => (
          <li key={shortcut.href}>
            <Link className={styles.shortcut} href={shortcut.href}>
              {shortcut.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
