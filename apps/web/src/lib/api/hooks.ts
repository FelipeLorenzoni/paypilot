"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiError, ApiResult } from "./api-error";

// Four-state data access (requirement 8), component-local by design: no global
// cache means logout/login can never surface another session's data (8.3).

export type QueryState<T> =
  | { status: "loading" }
  | { status: "error"; error: ApiError; retry: () => void }
  | { status: "empty" }
  | {
      status: "loaded";
      data: T;
      /**
       * Refetch in place, without a loading state: replaces `data` on success
       * and keeps it on failure. Resolves whether the refetch succeeded.
       */
      refresh: () => Promise<boolean>;
    };

type StoredState<T> =
  Exclude<QueryState<T>, { status: "loaded" }> | { status: "loaded"; data: T };

export function useApiQuery<T>(
  fn: () => Promise<ApiResult<T>>,
  deps: unknown[],
  isEmpty?: (data: T) => boolean,
): QueryState<T> {
  const [state, setState] = useState<StoredState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Latest callbacks without forcing them into deps (deps drive refetching).
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const isEmptyRef = useRef(isEmpty);
  isEmptyRef.current = isEmpty;
  // Bumped on every (re)load and on unmount so a stale refresh never lands.
  const generationRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const generation = ++generationRef.current;
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
      if (generationRef.current === generation) {
        generationRef.current += 1;
      }
    };
  }, [...deps, attempt]);

  const refresh = useCallback(async (): Promise<boolean> => {
    const generation = generationRef.current;
    const result = await fnRef.current();
    if (generation !== generationRef.current || !result.ok) {
      return false;
    }
    setState(
      isEmptyRef.current?.(result.data)
        ? { status: "empty" }
        : { status: "loaded", data: result.data },
    );
    return true;
  }, []);

  return state.status === "loaded" ? { ...state, refresh } : state;
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
