/**
 * Request/response contracts for the PayPilot API as consumed by the web app.
 *
 * Drift constraint: these types mirror, field for field, the shapes the api
 * returns today (`apps/api` mappers/services) but the api does NOT import them
 * yet — web-mvp-shell is frontend-only and leaves `apps/api` untouched. If an
 * api response changes, these types go stale until updated by hand; a future
 * cleanup spec has the api controllers/mappers implement these types directly.
 *
 * Conventions: amounts are integer minor units + explicit currency; dates are
 * date-only `YYYY-MM-DD` strings; invoice cycles are `YYYY-MM` strings.
 */
export type { AuthCredentials, AuthTokenResponse, MeResponse } from "./auth";
export type { PageMeta, Paginated, PageQuery } from "./pagination";
export type { ExpenseView } from "./expenses";
export type {
  RecurringBillView,
  RecurringBillListQuery,
} from "./recurring-bills";
export type {
  CreditCardView,
  InvoiceTransactionView,
  InvoiceView,
} from "./cards";
export type {
  ImportRowReasonCode,
  ImportInvalidRow,
  ImportSummary,
  ImportRunView,
} from "./imports";
export type { ReminderSettingsView, ReminderSettingsUpdate } from "./reminders";
