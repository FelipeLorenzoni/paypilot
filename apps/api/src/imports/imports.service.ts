import { createHash } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import { toAmountBigInt, toDateOnly } from "../common/ledger-money-date";
import { CsvStructuralError, parseCsv } from "./csv-parser";
import { dedupHash } from "./domain/dedup-key";
import { type RowReasonCode, validateRow } from "./domain/row-validator";
import {
  ImportLedgerWriter,
  type ImportCandidateRow,
} from "./import-ledger-writer";
import { MAX_FILE_BYTES, MAX_ROWS } from "./import.constants";
import { ImportsRepository } from "./imports.repository";

export interface ImportSummary {
  importRunId: string;
  totalRows: number;
  importedCount: number;
  duplicateCount: number;
  invalidCount: number;
  invalidRows: Array<{ lineNumber: number; reasonCode: RowReasonCode }>;
  /** Best-effort (app-level pre-pass); may under-report under concurrent
   * imports. Never contradicts the DB-derived counts above. */
  duplicateRows: Array<{ lineNumber: number }>;
}

export interface ImportRunView {
  id: string;
  status: string;
  totalRows: number;
  importedCount: number;
  duplicateCount: number;
  invalidCount: number;
  createdAt: string; // ISO UTC
}

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly repo: ImportsRepository,
    private readonly writer: ImportLedgerWriter,
  ) {}

  async import(userId: string, buffer: Buffer): Promise<ImportSummary> {
    // Whole-file bounds first: reject with NOTHING persisted.
    if (buffer.length > MAX_FILE_BYTES) {
      throw new PayloadTooLargeException("file exceeds the maximum size");
    }

    let parsed;
    try {
      parsed = parseCsv(buffer);
    } catch (error) {
      if (error instanceof CsvStructuralError) {
        throw new BadRequestException(`invalid CSV file: ${error.code}`);
      }
      throw error;
    }
    if (parsed.rows.length > MAX_ROWS) {
      throw new BadRequestException("file exceeds the maximum row count");
    }

    // Per-row validation: invalid rows are reported and skipped; the import continues.
    const invalidRows: Array<{
      lineNumber: number;
      reasonCode: RowReasonCode;
    }> = [];
    const valids: Array<{
      lineNumber: number;
      hash: string;
      candidate: ImportCandidateRow;
    }> = [];
    for (const { record, lineNumber } of parsed.rows) {
      const result = validateRow(record);
      if (!result.ok) {
        invalidRows.push({ lineNumber, reasonCode: result.reasonCode });
        continue;
      }
      const hash = dedupHash(
        result.candidate.date,
        result.candidate.amountMinor,
        result.candidate.description,
      );
      valids.push({
        lineNumber,
        hash,
        candidate: {
          transactionDate: toDateOnly(result.candidate.date),
          amountMinor: toAmountBigInt(result.candidate.amountMinor),
          currency: result.candidate.currency,
          description: result.candidate.description,
          categoryLabel: result.candidate.category,
          dedupHash: hash,
        },
      });
    }

    // Best-effort duplicate attribution for the summary (lineNumbers only).
    // The DB partial unique index is the guarantee: ALL valid candidates go to
    // createMany(skipDuplicates) and the insert count is the source of truth.
    const existing = await this.repo.findExistingHashes(
      userId,
      valids.map((v) => v.hash),
    );
    const seenInFile = new Set<string>();
    const duplicateRows: Array<{ lineNumber: number }> = [];
    for (const v of valids) {
      if (existing.has(v.hash) || seenInFile.has(v.hash)) {
        duplicateRows.push({ lineNumber: v.lineNumber });
      }
      seenInFile.add(v.hash);
    }

    const result = await this.writer.persist({
      userId,
      fileHash: createHash("sha256").update(buffer).digest("hex"),
      totalRows: parsed.rows.length,
      invalidCount: invalidRows.length,
      candidates: valids.map((v) => v.candidate),
    });

    // Never log the raw body/rows — operation, user, counts only.
    this.logger.log(
      `csv-import userId=${userId} run=${result.runId} total=${parsed.rows.length} imported=${result.importedCount} duplicate=${result.duplicateCount} invalid=${invalidRows.length}`,
    );

    return {
      importRunId: result.runId,
      totalRows: parsed.rows.length,
      importedCount: result.importedCount,
      duplicateCount: result.duplicateCount,
      invalidCount: invalidRows.length,
      invalidRows,
      duplicateRows,
    };
  }

  async getRun(userId: string, id: string): Promise<ImportRunView> {
    const run = await this.repo.findOwnedRun(userId, id);
    if (!run) {
      throw new NotFoundException();
    }
    return {
      id: run.id,
      status: run.status,
      totalRows: run.totalRows,
      importedCount: run.importedCount,
      duplicateCount: run.duplicateCount,
      invalidCount: run.invalidCount,
      createdAt: run.createdAt.toISOString(),
    };
  }
}
