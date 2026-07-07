"use client";

import type { ReactNode } from "react";
import { ErrorState } from "../../components/ui/error-state";

/**
 * Segment crash net (requirement 6.7): an unexpected render/runtime error in a
 * page renders here, inside the shell — header and navigation stay functional.
 */
export default function AppError({
  reset,
}: {
  error: Error;
  reset: () => void;
}): ReactNode {
  return (
    <ErrorState
      message="Something went wrong on this page."
      requestId={null}
      onRetry={reset}
    />
  );
}
