import type { BillPaymentView, SetBillPaymentRequest } from "@paypilot/shared";
import type { ApiResult } from "./api-error";
import { request } from "./http";

/** Mark or unmark one payable item; the backend derives its identity key. */
export function setBillPayment(
  body: SetBillPaymentRequest,
): Promise<ApiResult<BillPaymentView>> {
  return request("/bill-payments", { method: "PUT", body });
}
