import { parse } from "csv-parse/sync";

// Parsing of the untrusted CSV buffer (RFC-4180 via csv-parse, sync API — the
// MVP import is synchronous within bounded limits). Structural failures throw
// CsvStructuralError, which the service maps to a whole-file 400 with NOTHING
// persisted. Row-level field problems are NOT handled here (RowValidator).

export class CsvStructuralError extends Error {
  constructor(
    public readonly code:
      | "EMPTY_FILE"
      | "MALFORMED_CSV"
      | "INVALID_HEADER"
      | "COLUMN_COUNT_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "CsvStructuralError";
  }
}

const REQUIRED_COLUMNS = ["date", "amount", "description"] as const;
const OPTIONAL_COLUMNS = ["category", "currency"] as const;

export interface ParsedCsvRow {
  record: Record<string, string>;
  /** Physical line in the file (header = line 1; blank lines counted). */
  lineNumber: number;
}

export interface ParsedCsv {
  delimiter: "," | ";";
  header: string[];
  rows: ParsedCsvRow[];
}

/**
 * Parse and structurally validate a CSV buffer.
 *
 * - **Delimiter detection** is deterministic from the header line: if it
 *   contains `;` the delimiter is `;`, otherwise `,` (header names never
 *   contain either). Under `;`, Brazilian amounts (`1.234,56`) may appear
 *   unquoted; under `,`, a comma-bearing amount MUST be RFC-4180 quoted
 *   (`"1.234,56"`) — an unquoted comma changes the row's column count, which
 *   is a structural failure (safer than silently misparsing money).
 * - Header must contain all required columns (date, amount, description),
 *   only known columns, and no duplicates. Blank lines are skipped.
 */
export function parseCsv(buffer: Buffer): ParsedCsv {
  const text = buffer.toString("utf8");
  const newlineAt = text.indexOf("\n");
  const firstLine = newlineAt === -1 ? text : text.slice(0, newlineAt);
  const delimiter: "," | ";" = firstLine.includes(";") ? ";" : ",";

  let records: Array<{ record: string[]; info: { lines: number } }>;
  try {
    // With `info: true` csv-parse returns { record, info } pairs; its published
    // types only describe the plain-array shape, hence the two-step cast.
    records = parse(text, {
      delimiter,
      bom: true,
      skip_empty_lines: true,
      info: true,
    }) as unknown as Array<{ record: string[]; info: { lines: number } }>;
  } catch (error) {
    throw new CsvStructuralError(
      "MALFORMED_CSV",
      error instanceof Error ? error.message : "unparseable CSV",
    );
  }

  if (records.length === 0) {
    throw new CsvStructuralError("EMPTY_FILE", "the file has no header row");
  }

  const headerEntry = records[0] as {
    record: string[];
    info: { lines: number };
  };
  const header = headerEntry.record.map((name) => name.trim().toLowerCase());
  const known = new Set<string>([...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS]);
  const missing = REQUIRED_COLUMNS.filter((name) => !header.includes(name));
  const unknown = header.filter((name) => !known.has(name));
  const hasDuplicates = new Set(header).size !== header.length;
  if (missing.length > 0 || unknown.length > 0 || hasDuplicates) {
    throw new CsvStructuralError(
      "INVALID_HEADER",
      `expected columns date, amount, description (+ optional category, currency); got: ${header.join(", ")}`,
    );
  }

  const rows: ParsedCsvRow[] = records.slice(1).map(({ record, info }) => {
    if (record.length !== header.length) {
      // e.g. an unquoted comma inside a value under the ',' delimiter.
      throw new CsvStructuralError(
        "COLUMN_COUNT_MISMATCH",
        `line ${info.lines}: expected ${header.length} columns, got ${record.length}`,
      );
    }
    const mapped: Record<string, string> = {};
    header.forEach((name, i) => {
      mapped[name] = record[i] as string;
    });
    return { record: mapped, lineNumber: info.lines };
  });

  return { delimiter, header, rows };
}
