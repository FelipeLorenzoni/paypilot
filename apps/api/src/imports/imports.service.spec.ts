import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import type { ImportLedgerWriter } from "./import-ledger-writer";
import { MAX_FILE_BYTES } from "./import.constants";
import type { ImportsRepository } from "./imports.repository";
import { ImportsService } from "./imports.service";

const findExistingHashes = jest.fn();
const findOwnedRun = jest.fn();
const persist = jest.fn();

const repo = {
  findExistingHashes,
  findOwnedRun,
} as unknown as ImportsRepository;
const writer = { persist } as unknown as ImportLedgerWriter;
const service = new ImportsService(repo, writer);

const csv = (s: string) => Buffer.from(s, "utf8");

afterEach(() => jest.clearAllMocks());

describe("ImportsService.import", () => {
  it("rejects an oversized file with 413 and persists nothing", async () => {
    const big = Buffer.alloc(MAX_FILE_BYTES + 1, 97);
    await expect(service.import("u1", big)).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects a structurally invalid header with 400 and persists nothing", async () => {
    await expect(
      service.import("u1", csv("data,valor\n2026-03-01,10\n")),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(persist).not.toHaveBeenCalled();
  });

  it("imports valid rows, reports invalid rows, counts DB-derived", async () => {
    findExistingHashes.mockResolvedValue(new Set());
    persist.mockResolvedValue({
      runId: "run-1",
      status: "COMPLETED",
      createdAt: new Date(),
      importedCount: 2,
      duplicateCount: 0,
    });

    const summary = await service.import(
      "u1",
      csv(
        "date,amount,description\n" +
          "2026-03-01,10.50,Lunch\n" +
          "bad-date,10,Broken\n" +
          "2026-03-02,-5,Refund\n" +
          "2026-03-03,20,Taxi\n",
      ),
    );

    expect(summary).toMatchObject({
      importRunId: "run-1",
      totalRows: 4,
      importedCount: 2,
      duplicateCount: 0,
      invalidCount: 2,
    });
    expect(summary.invalidRows).toEqual([
      { lineNumber: 3, reasonCode: "INVALID_DATE" },
      { lineNumber: 4, reasonCode: "NON_POSITIVE_AMOUNT" },
    ]);
    // ALL valid candidates are handed to the writer (DB decides dedup).
    expect(persist.mock.calls[0][0].candidates).toHaveLength(2);
    expect(persist.mock.calls[0][0].totalRows).toBe(4);
    expect(persist.mock.calls[0][0].invalidCount).toBe(2);
  });

  it("attributes duplicate lineNumbers best-effort (existing + in-file first-wins)", async () => {
    persist.mockResolvedValue({
      runId: "run-1",
      status: "COMPLETED",
      createdAt: new Date(),
      importedCount: 1,
      duplicateCount: 2,
    });
    // Same normalized row twice in-file + one row already existing in the DB.
    findExistingHashes.mockImplementation((_u: string, hashes: string[]) =>
      Promise.resolve(new Set([hashes[2]])),
    );

    const summary = await service.import(
      "u1",
      csv(
        "date,amount,description\n" +
          "2026-03-01,10,Coffee\n" +
          "2026-03-01,10,  COFFEE \n" + // in-file duplicate (normalized)
          "2026-03-02,20,Existing\n",
      ),
    );

    expect(summary.duplicateRows).toEqual([
      { lineNumber: 3 },
      { lineNumber: 4 },
    ]);
    expect(summary.importedCount).toBe(1); // from the DB, not the pre-pass
    expect(summary.duplicateCount).toBe(2);
  });
});

describe("ImportsService.getRun", () => {
  it("returns the owner's run view", async () => {
    findOwnedRun.mockResolvedValue({
      id: "run-1",
      status: "COMPLETED",
      totalRows: 4,
      importedCount: 2,
      duplicateCount: 1,
      invalidCount: 1,
      createdAt: new Date("2026-07-01T12:00:00.000Z"),
    });
    await expect(service.getRun("u1", "run-1")).resolves.toEqual({
      id: "run-1",
      status: "COMPLETED",
      totalRows: 4,
      importedCount: 2,
      duplicateCount: 1,
      invalidCount: 1,
      createdAt: "2026-07-01T12:00:00.000Z",
    });
  });

  it("throws 404 when the run is not owned/unknown", async () => {
    findOwnedRun.mockResolvedValue(null);
    await expect(service.getRun("u1", "run-x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
