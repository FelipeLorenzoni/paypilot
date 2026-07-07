"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { useAuth } from "../../lib/session/auth-context";
import styles from "./app-shell.module.css";

export const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/expenses", label: "Expenses" },
  { href: "/bills", label: "Recurring bills" },
  { href: "/cards", label: "Cards & invoices" },
  { href: "/imports", label: "CSV imports" },
  { href: "/reminders", label: "Reminders/settings" },
] as const;

/** Authenticated chrome: header (brand, user, logout) + sidebar nav + main. */
export function AppShell({ children }: { children: ReactNode }): ReactNode {
  const { user, logout } = useAuth();
  const pathname = usePathname();

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.brand}>PayPilot</span>
        <span className={styles.email}>{user.email}</span>
        <Button variant="secondary" onClick={logout}>
          Log out
        </Button>
      </header>
      <div className={styles.body}>
        <nav aria-label="Main navigation" className={styles.nav}>
          <ul className={styles.navList}>
            {NAV_ITEMS.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    className={styles.navLink}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
