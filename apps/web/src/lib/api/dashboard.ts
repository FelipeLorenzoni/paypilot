import type { MonthlySummaryView } from "@paypilot/shared";
import type { ApiResult } from "./api-error";
import { request } from "./http";

/** The current month's summary; the backend resolves "current" from its clock. */
export function getMonthlySummary(): Promise<ApiResult<MonthlySummaryView>> {
  return request("/dashboard/summary");
}
