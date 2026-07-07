"use client";

import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ImportInvalidRow, ImportSummary } from "@paypilot/shared";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { Field } from "../../components/ui/field";
import { FormError } from "../../components/ui/form-error";
import { Loading } from "../../components/ui/loading";
import { Table } from "../../components/ui/table";
import { useApiMutation, useApiQuery } from "../../lib/api/hooks";
import { getImportRun, uploadImport } from "../../lib/api/imports";
import { mapApiErrorToForm } from "../../lib/api/error-mapping";
import styles from "./imports-page.module.css";

const INVALID_ROW_COLUMNS = [
  {
    header: "Line",
    render: (row: ImportInvalidRow) => String(row.lineNumber),
  },
  {
    header: "Reason",
    render: (row: ImportInvalidRow) => row.reasonCode,
  },
];

// Whole-file rejections (requirement 6.4): 413 arrives as the exception-name
// code, 400 as VALIDATION_ERROR without matching form fields.
const UPLOAD_MESSAGES: Record<string, string> = {
  PayloadTooLargeException:
    "The file exceeds the maximum allowed size. Split it and try again.",
};

function SummaryView({ summary }: { summary: ImportSummary }): ReactNode {
  return (
    <div className={styles.summary}>
      <h3>Import result</h3>
      <ul className={styles.counts}>
        <li>Total rows: {summary.totalRows}</li>
        <li>Imported: {summary.importedCount}</li>
        <li>Duplicates: {summary.duplicateCount}</li>
        <li>Invalid: {summary.invalidCount}</li>
      </ul>
      {summary.invalidRows.length > 0 ? (
        <Table
          caption="Invalid rows"
          columns={INVALID_ROW_COLUMNS}
          rows={summary.invalidRows}
          rowKey={(row) => String(row.lineNumber)}
        />
      ) : null}
    </div>
  );
}

function RunLookupResult({ id }: { id: string }): ReactNode {
  const state = useApiQuery(() => getImportRun(id), [id]);

  if (state.status === "loading") {
    return <Loading />;
  }
  if (state.status === "error") {
    if (state.error.code === "NOT_FOUND") {
      return (
        <EmptyState
          title="Import run not found"
          description="Check the run id — it must be one of your own import runs."
        />
      );
    }
    return (
      <ErrorState
        message="Could not load this import run."
        requestId={state.error.requestId}
        onRetry={state.retry}
      />
    );
  }
  if (state.status === "loaded") {
    const run = state.data;
    return (
      <div className={styles.summary}>
        <h3>Run {run.id}</h3>
        <ul className={styles.counts}>
          <li>Status: {run.status}</li>
          <li>Total rows: {run.totalRows}</li>
          <li>Imported: {run.importedCount}</li>
          <li>Duplicates: {run.duplicateCount}</li>
          <li>Invalid: {run.invalidCount}</li>
        </ul>
      </div>
    );
  }
  return null;
}

export function ImportsPage(): ReactNode {
  const fileId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [uploadError, setUploadError] = useState<{
    message: string;
    requestId: string | null;
  } | null>(null);
  const upload = useApiMutation(uploadImport);

  const [runIdInput, setRunIdInput] = useState("");
  const [lookupId, setLookupId] = useState<string | null>(null);

  async function handleUpload(event: FormEvent): Promise<void> {
    event.preventDefault();
    setUploadError(null);
    setSummary(null);

    const file = fileInput.current?.files?.[0];
    if (!file) {
      setUploadError({
        message: "Choose a CSV file to upload.",
        requestId: null,
      });
      return;
    }

    const result = await upload.run(file);
    if (result.ok) {
      setSummary(result.data);
      if (fileInput.current) {
        fileInput.current.value = "";
      }
    } else {
      const mapped = mapApiErrorToForm(result.error, [], UPLOAD_MESSAGES);
      setUploadError({
        message: mapped.formMessage ?? "The upload failed. Please try again.",
        requestId: mapped.requestId,
      });
    }
  }

  function handleLookup(event: FormEvent): void {
    event.preventDefault();
    const trimmed = runIdInput.trim();
    if (trimmed) {
      setLookupId(trimmed);
    }
  }

  return (
    <div>
      <h1>CSV imports</h1>

      <section className={styles.section}>
        <h2>Upload a CSV</h2>
        <FormError
          message={uploadError?.message ?? null}
          requestId={uploadError?.requestId}
        />
        <form
          className={styles.uploadForm}
          onSubmit={(event) => void handleUpload(event)}
          noValidate
        >
          <span className={styles.fileField}>
            <label className={styles.fileLabel} htmlFor={fileId}>
              CSV file
            </label>
            <input
              id={fileId}
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
            />
          </span>
          <Button type="submit" pending={upload.pending}>
            Upload
          </Button>
        </form>
        {summary ? <SummaryView summary={summary} /> : null}
      </section>

      <section className={styles.section}>
        <h2>Look up a past run</h2>
        <form className={styles.lookupForm} onSubmit={handleLookup} noValidate>
          <Field
            label="Import run ID"
            name="runId"
            value={runIdInput}
            onChange={(event) => setRunIdInput(event.target.value)}
          />
          <Button type="submit">Look up</Button>
        </form>
        <div className={styles.runResult}>
          {lookupId ? <RunLookupResult id={lookupId} /> : null}
        </div>
      </section>
    </div>
  );
}
