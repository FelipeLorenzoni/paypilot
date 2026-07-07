import type { ImportRunView, ImportSummary } from "@paypilot/shared";
import type { ApiResult } from "./api-error";
import { request } from "./http";

export function uploadImport(file: File): Promise<ApiResult<ImportSummary>> {
  const formData = new FormData();
  formData.append("file", file);
  return request("/imports", { method: "POST", formData });
}

export function getImportRun(id: string): Promise<ApiResult<ImportRunView>> {
  return request(`/imports/${encodeURIComponent(id)}`);
}
