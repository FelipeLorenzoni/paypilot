/** Stable per-row rejection codes surfaced in `ImportSummary.invalidRows`. */
export type ImportRowReasonCode =
  | "MISSING_FIELD"
  | "INVALID_DATE"
  | "INVALID_AMOUNT_FORMAT"
  | "NON_POSITIVE_AMOUNT"
  | "UNSUPPORTED_CURRENCY"
  | "FIELD_TOO_LONG";

/** One rejected CSV row (line number + coded reason; row contents never echoed). */
export interface ImportInvalidRow {
  lineNumber: number;
  reasonCode: ImportRowReasonCode;
}

/** `POST /imports` success body (the api's `ImportSummary`). */
export interface ImportSummary {
  importRunId: string;
  totalRows: number;
  importedCount: number;
  duplicateCount: number;
  invalidCount: number;
  invalidRows: ImportInvalidRow[];
  /** Best-effort (app-level pre-pass); may under-report under concurrent
   * imports. Never contradicts the DB-derived counts above. */
  duplicateRows: Array<{ lineNumber: number }>;
}

/** Past import run as returned by `GET /imports/:id` (the api's `ImportRunView`). */
export interface ImportRunView {
  id: string;
  status: string;
  totalRows: number;
  importedCount: number;
  duplicateCount: number;
  invalidCount: number;
  createdAt: string; // ISO UTC
}
