"use client";

import type { ReactNode } from "react";
import { AppShell } from "../../features/shell/app-shell";
import { AuthProvider } from "../../lib/session/auth-context";

/**
 * The single auth gate: every route under `(app)` inherits protection and the
 * shell — no per-page auth wiring anywhere (deny by default).
 */
export default function AppLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <AuthProvider>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
