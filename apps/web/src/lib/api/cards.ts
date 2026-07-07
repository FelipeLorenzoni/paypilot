import type {
  CreditCardView,
  InvoiceView,
  Paginated,
  PageQuery,
} from "@paypilot/shared";
import type { ApiResult } from "./api-error";
import { request } from "./http";

export function listCreditCards(
  query: PageQuery = {},
): Promise<ApiResult<Paginated<CreditCardView>>> {
  return request("/credit-cards", {
    query: { page: query.page, pageSize: query.pageSize },
  });
}

export function getInvoice(
  cardId: string,
  cycle: string,
): Promise<ApiResult<InvoiceView>> {
  return request(
    `/credit-cards/${encodeURIComponent(cardId)}/invoices/${encodeURIComponent(cycle)}`,
  );
}
