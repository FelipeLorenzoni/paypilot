/** Pagination metadata attached to every list response. */
export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}

/** Canonical `{ data, meta }` list envelope returned by list endpoints. */
export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

/** Pagination query accepted by list endpoints (`page` >= 1, `pageSize` 1–100). */
export interface PageQuery {
  page?: number;
  pageSize?: number;
}
