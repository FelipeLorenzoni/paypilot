import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** One validated candidate row, ready to persist. */
export interface ImportCandidateRow {
  transactionDate: Date; // date-only (UTC midnight)
  amountMinor: bigint;
  currency: string; // BRL (validator-guaranteed)
  description: string;
  categoryLabel: string | null;
  dedupHash: string;
}

export interface PersistInput {
  userId: string;
  fileHash: string | null;
  totalRows: number;
  invalidCount: number;
  candidates: ImportCandidateRow[];
}

export interface PersistResult {
  runId: string;
  status: string;
  createdAt: Date;
  importedCount: number;
  duplicateCount: number;
}

/**
 * Owns the atomic persistence of an import: the `ImportRun` plus all accepted
 * rows in a **single interactive transaction** — an unexpected failure rolls
 * everything back (no run, no rows). Dedup is decided ENTIRELY by the database:
 * every valid candidate goes into `createMany({ skipDuplicates: true })`
 * (`ON CONFLICT DO NOTHING` against the partial unique `(userId, dedupHash)
 * WHERE source = 'IMPORTED'`), which also resolves in-file duplicates
 * first-wins within the single statement. The returned insert count is the
 * source of truth for `importedCount` under concurrent/overlapping imports.
 */
@Injectable()
export class ImportLedgerWriter {
  constructor(private readonly prisma: PrismaService) {}

  async persist(input: PersistInput): Promise<PersistResult> {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.importRun.create({
        data: {
          userId: input.userId,
          fileHash: input.fileHash,
          totalRows: input.totalRows,
          invalidCount: input.invalidCount,
        },
      });
      const { count } = await tx.transaction.createMany({
        data: input.candidates.map((c) => ({
          userId: input.userId,
          type: "EXPENSE" as const,
          source: "IMPORTED" as const,
          amountMinor: c.amountMinor,
          currency: c.currency,
          transactionDate: c.transactionDate,
          description: c.description,
          categoryLabel: c.categoryLabel,
          dedupHash: c.dedupHash,
          importRunId: run.id,
        })),
        skipDuplicates: true,
      });
      const duplicateCount = input.candidates.length - count;
      const updated = await tx.importRun.update({
        where: { id: run.id },
        data: {
          importedCount: count,
          duplicateCount,
          status: "COMPLETED",
        },
      });
      return {
        runId: updated.id,
        status: updated.status,
        createdAt: updated.createdAt,
        importedCount: count,
        duplicateCount,
      };
    });
  }
}
