"use client";

import type { ReactNode } from "react";
import { Button } from "./button";
import styles from "./pagination.module.css";

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

/** Previous/next pagination honoring the API's `page`/`pageSize`/`total` meta. */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: PaginationProps): ReactNode {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label="Pagination" className={styles.pagination}>
      <Button
        variant="secondary"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </Button>
      <span className={styles.status}>
        Page {page} of {pageCount}
      </span>
      <Button
        variant="secondary"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}
