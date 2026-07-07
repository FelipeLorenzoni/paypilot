"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiError, ApiResult } from "./api-error";

// Four-state data access (requirement 8), component-local by design: no global
// cache means logout/login can never surface another session's data (8.3).

export type QueryState<T> =
  | { status: "loading" }
  | { status: "error"; error: ApiError; retry: () => void }
  | { status: "empty" }
  | { status: "loaded"; data: T };

export function useApiQuery<T>(
  fn: () => Promise<ApiResult<T>>,
  deps: unknown[],
  isEmpty?: (data: T) => boolean,
): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Latest callbacks without forcing them into deps (deps drive refetching).
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const isEmptyRef = useRef(isEmpty);
  isEmptyRef.current = isEmpty;

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void fnRef.current().then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setState(
          isEmptyRef.current?.(result.data)
            ? { status: "empty" }
            : { status: "loaded", data: result.data },
        );
      } else {
        setState({
          status: "error",
          error: result.error,
          retry: () => setAttempt((current) => current + 1),
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [...deps, attempt]);

  return state;
}

export interface MutationState<I, O> {
  run: (input: I) => Promise<ApiResult<O>>;
  pending: boolean;
  error: ApiError | null;
}

export function useApiMutation<I, O>(
  fn: (input: I) => Promise<ApiResult<O>>,
): MutationState<I, O> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (input: I): Promise<ApiResult<O>> => {
    setPending(true);
    setError(null);
    const result = await fnRef.current(input);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
    }
    return result;
  }, []);

  return { run, pending, error };
}
