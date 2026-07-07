import type {
  Paginated,
  RecurringBillListQuery,
  RecurringBillView,
} from "@paypilot/shared";
import type { ApiResult } from "./api-error";
import { request } from "./http";

export function listRecurringBills(
  query: RecurringBillListQuery = {},
): Promise<ApiResult<Paginated<RecurringBillView>>> {
  return request("/recurring-bills", {
    query: { page: query.page, pageSize: query.pageSize, active: query.active },
  });
}
