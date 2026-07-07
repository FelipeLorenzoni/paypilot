import type { ExpenseView, Paginated, PageQuery } from "@paypilot/shared";
import type { ApiResult } from "./api-error";
import { request } from "./http";

export function listExpenses(
  query: PageQuery = {},
): Promise<ApiResult<Paginated<ExpenseView>>> {
  return request("/expenses", {
    query: { page: query.page, pageSize: query.pageSize },
  });
}
