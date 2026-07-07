"use client";

import type { MeResponse } from "@paypilot/shared";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ErrorState } from "../../components/ui/error-state";
import { Loading } from "../../components/ui/loading";
import { getMe } from "../api/auth";
import { sessionStore } from "./session-store";

// The ONLY owner of auth navigation. The api client clears the session on
// UNAUTHORIZED and notifies through the store subscription; every redirect to
// /login happens here (design fix — the client never navigates).

export interface AuthContextValue {
  user: MeResponse;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

type GuardState =
  | { status: "checking" }
  | { status: "error"; message: string; requestId: string | null }
  | { status: "ready"; user: MeResponse };

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const router = useRouter();
  const [state, setState] = useState<GuardState>({ status: "checking" });
  const [attempt, setAttempt] = useState(0);

  // Session-change subscription: logout or a client-detected UNAUTHORIZED
  // clears the store; the guard observes it and performs the redirect (2.3).
  useEffect(() => {
    return sessionStore.subscribe(() => {
      if (sessionStore.get() === null) {
        router.replace("/login");
      }
    });
  }, [router]);

  useEffect(() => {
    if (sessionStore.get() === null) {
      router.replace("/login"); // deny by default; no authenticated calls (2.2)
      return;
    }
    let cancelled = false;
    setState({ status: "checking" });
    void getMe().then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setState({ status: "ready", user: result.data });
      } else if (result.error.code !== "UNAUTHORIZED") {
        // UNAUTHORIZED already cleared the session (redirect handled above);
        // anything else gets a retryable full-page error.
        setState({
          status: "error",
          message: result.error.message,
          requestId: result.error.requestId,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router, attempt]);

  const logout = useCallback(() => {
    sessionStore.clear(); // the subscription above performs the redirect (1.5)
  }, []);

  if (state.status === "checking") {
    return <Loading label="Loading your session…" />;
  }
  if (state.status === "error") {
    return (
      <ErrorState
        message={state.message}
        requestId={state.requestId}
        onRetry={() => setAttempt((current) => current + 1)}
      />
    );
  }
  return (
    <AuthContext.Provider value={{ user: state.user, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
}
