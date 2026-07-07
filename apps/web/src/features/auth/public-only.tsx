"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Loading } from "../../components/ui/loading";
import { sessionStore } from "../../lib/session/session-store";

/**
 * Wraps public auth pages: an already-authenticated visitor is sent to the
 * dashboard (login/register are reachable while unauthenticated only).
 */
export function PublicOnly({ children }: { children: ReactNode }): ReactNode {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (sessionStore.get() !== null) {
      router.replace("/dashboard");
    } else {
      setReady(true);
    }
  }, [router]);

  if (!ready) {
    return <Loading />;
  }
  return children;
}
