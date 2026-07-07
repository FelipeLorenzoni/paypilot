import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportRunView, ImportSummary } from "@paypilot/shared";
import { ApiError, type ApiResult } from "../../lib/api/api-error";
import { ImportsPage } from "./imports-page";

const uploadImport = vi.fn<(file: File) => Promise<ApiResult<ImportSummary>>>();
const getImportRun = vi.fn<(id: string) => Promise<ApiResult<ImportRunView>>>();

vi.mock("../../lib/api/imports", () => ({
  uploadImport: (file: File): Promise<ApiResult<ImportSummary>> =>
    uploadImport(file),
  getImportRun: (id: string): Promise<ApiResult<ImportRunView>> =>
    getImportRun(id),
}));

const summary: ImportSummary = {
  importRunId: "run-1",
  totalRows: 10,
  importedCount: 7,
  duplicateCount: 2,
  invalidCount: 1,
  invalidRows: [{ lineNumber: 4, reasonCode: "INVALID_DATE" }],
  duplicateRows: [{ lineNumber: 2 }, { lineNumber: 3 }],
};

const run: ImportRunView = {
  id: "run-9",
  status: "COMPLETED",
  totalRows: 5,
  importedCount: 5,
  duplicateCount: 0,
  invalidCount: 0,
  createdAt: "2026-06-01T10:00:00.000Z",
};

async function uploadCsv(): Promise<void> {
  const user = userEvent.setup();
  const file = new File(["date,amount,description\n"], "data.csv", {
    type: "text/csv",
  });
  await user.upload(screen.getByLabelText("CSV file"), file);
  await user.click(screen.getByRole("button", { name: "Upload" }));
}

beforeEach(() => {
  uploadImport.mockReset();
  getImportRun.mockReset();
});

describe("ImportsPage", () => {
  it("uploads a CSV and renders the summary with invalid rows", async () => {
    uploadImport.mockResolvedValue({ ok: true, data: summary });
    render(<ImportsPage />);
    await uploadCsv();

    await waitFor(() => expect(screen.getByText(/Imported: 7/)).toBeDefined());
    expect(uploadImport).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Total rows: 10/)).toBeDefined();
    expect(screen.getByText(/Duplicates: 2/)).toBeDefined();
    expect(screen.getByText(/Invalid: 1/)).toBeDefined();

    const table = within(screen.getByRole("table"));
    expect(table.getByText("4")).toBeDefined();
    expect(table.getByText("INVALID_DATE")).toBeDefined();
  });

  it("maps a 413 whole-file rejection to a form-level error with requestId", async () => {
    uploadImport.mockResolvedValue({
      ok: false,
      error: new ApiError({
        code: "PayloadTooLargeException",
        message: "file exceeds the maximum size",
        requestId: "req-413",
      }),
    });
    render(<ImportsPage />);
    await uploadCsv();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("maximum allowed size");
    expect(alert.textContent).toContain("req-413");
  });

  it("maps a 400 whole-file rejection to a form-level error with requestId", async () => {
    uploadImport.mockResolvedValue({
      ok: false,
      error: new ApiError({
        code: "VALIDATION_ERROR",
        message: "invalid csv structure",
        requestId: "req-400",
      }),
    });
    render(<ImportsPage />);
    await uploadCsv();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("req-400");
  });

  it("requires a file before uploading", async () => {
    render(<ImportsPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(uploadImport).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "Choose a CSV file",
    );
  });

  it("looks up a past run by id", async () => {
    getImportRun.mockResolvedValue({ ok: true, data: run });
    render(<ImportsPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Import run ID"), "run-9");
    await user.click(screen.getByRole("button", { name: "Look up" }));

    await waitFor(() => expect(screen.getByText(/COMPLETED/)).toBeDefined());
    expect(getImportRun).toHaveBeenCalledWith("run-9");
    expect(screen.getByText(/Imported: 5/)).toBeDefined();
  });

  it("shows a friendly message when the run is not found", async () => {
    getImportRun.mockResolvedValue({
      ok: false,
      error: new ApiError({
        code: "NOT_FOUND",
        message: "not found",
        requestId: "req-run-1",
      }),
    });
    render(<ImportsPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Import run ID"), "missing-run");
    await user.click(screen.getByRole("button", { name: "Look up" }));

    await waitFor(() =>
      expect(screen.getByText("Import run not found")).toBeDefined(),
    );
  });
});
