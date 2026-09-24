import type { Report, YunxiaoWorkItemList } from "../types";

type ApiError = Error & { status?: number };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body && !isForm ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof body?.error === "string" ? body.error : `请求失败（${res.status}）`;
    const error = new Error(message) as ApiError;
    error.status = res.status;
    throw error;
  }
  return body as T;
}

function apiStatus(err: unknown): number | undefined {
  return err instanceof Error ? (err as ApiError).status : undefined;
}

function apiMessage(err: unknown): string {
  return err instanceof Error ? err.message.trim() : "";
}

export function yunxiaoErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.name === "AbortError") return fallback;
  if (err instanceof TypeError) {
    return "无法连接本机服务，请确认服务已启动后再试。";
  }
  const status = apiStatus(err);
  const message = apiMessage(err);

  if (status === 404 && (!message || /^not found$/i.test(message))) {
    return "云效导入服务暂不可用（接口未就绪或已下线）。";
  }
  if (status === 401 || status === 403) {
    return "云效鉴权失败，请检查本机 .env 中的 YUNXIAO_PAT / YUNXIAO_ORG_ID。";
  }
  if (status === 502 && /authentication failed/i.test(message)) {
    return "云效鉴权失败，请检查本机 .env 中的 YUNXIAO_PAT / YUNXIAO_ORG_ID。";
  }
  if (status === 500 && /YUNXIAO_/i.test(message)) {
    return "请在项目 .env 填写 YUNXIAO_ORG_ID 和 YUNXIAO_PAT 后重启服务。";
  }
  if (message) return message;
  return fallback;
}

const HAS_CJK = /[\u3400-\u9fff]/;

export function ingestErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.name === "AbortError") return fallback;
  if (err instanceof TypeError) {
    return "无法连接本机服务，请确认服务已启动后再试。";
  }
  const status = apiStatus(err);
  const message = apiMessage(err);

  if (/file must be \.xlsx or \.csv/i.test(message)) {
    return "请上传 .xlsx 或 .csv 文件。";
  }
  if (/file has no rows/i.test(message)) {
    return "文件没有数据行。";
  }
  if (/missing required columns/i.test(message)) {
    return "缺少必填列：事项标题、状态。";
  }
  if (/workbook has no sheets/i.test(message)) {
    return "工作簿没有工作表，请检查 xlsx 文件。";
  }
  if (/upload exceeds/i.test(message) || status === 413) {
    return "文件过大，请压缩或删减行后再上传。";
  }
  if (
    /missing multipart file field ['"]?file['"]?/i.test(message) ||
    /expected multipart\/form-data/i.test(message)
  ) {
    return "请选择要上传的表格文件。";
  }
  if (/malformed multipart/i.test(message)) {
    return "上传内容格式不正确，请重新选择文件。";
  }
  if (/previewid is required/i.test(message)) {
    return "缺少预览编号，请重新上传。";
  }
  if (/preview not found/i.test(message)) {
    return "预览已过期或不存在，请重新上传。";
  }
  if (status === 404 && (!message || /^not found$/i.test(message))) {
    return "表格上传服务暂不可用（接口未就绪或已下线）。";
  }
  if (HAS_CJK.test(message)) return message;
  if (status && status >= 500) {
    return `服务异常（${status}），请稍后重试。`;
  }
  if (status && status >= 400) {
    return `请求失败（${status}），请检查文件后重试。`;
  }
  return fallback;
}

export function ingestRowError(error?: string): string {
  if (!error?.trim()) return "未通过";
  return error
    .split(/;\s*/)
    .map((part) => {
      if (/事项标题 is required/i.test(part)) return "事项标题为必填";
      if (/状态 is required/i.test(part)) return "状态为必填";
      return part;
    })
    .join("；");
}

export function listYunxiaoWorkItems(updatedWithinDays = 14, init?: RequestInit) {
  const query = new URLSearchParams({ updatedWithinDays: String(updatedWithinDays) });
  return request<YunxiaoWorkItemList>(`/api/yunxiao/workitems?${query}`, init);
}

export type ConfirmMaterials = {
  projects: Report["projects"];
  /** Backend stores this array as `issues` (not `{ empty, items }`). */
  issues: Report["issues"]["items"];
  nextWeek: Report["nextWeek"];
};

export type ConfirmImportOptions = {
  /** Default true. false skips similar-name module merge; exact module labels still group. */
  moduleAutoMerge?: boolean;
  /** Client-edited draft. When set, server keeps these arrays and skips auto-merge. */
  materials?: ConfirmMaterials;
};

/**
 * POST /api/yunxiao/import accepts `moduleAutoMerge` (boolean, default true)
 * and optional `materials` `{ projects, issues, nextWeek }` arrays.
 * @backend field already on main: do not send `autoMergeModules`.
 */
export function importYunxiaoWorkItems(
  itemIds: string[],
  reportPartial?: Partial<Report>,
  options: ConfirmImportOptions = {},
) {
  const moduleAutoMerge = options.moduleAutoMerge !== false;
  return request<Report>("/api/yunxiao/import", {
    method: "POST",
    body: JSON.stringify({
      itemIds,
      moduleAutoMerge,
      ...(reportPartial ? { reportPartial } : {}),
      ...(options.materials ? { materials: options.materials } : {}),
    }),
  });
}

export type IngestPreviewRow = {
  row: number;
  ok: boolean;
  error?: string;
  title: string;
  status: string;
  module?: string;
  owner?: string;
  detail?: string;
  planDate?: string;
  sourceId?: string;
};

export type IngestPreview = {
  previewId: string;
  rows: IngestPreviewRow[];
  summary: { total: number; ok: number; error: number };
};

export function uploadIngestFile(file: File | Blob, filename?: string) {
  const form = new FormData();
  if (filename) form.append("file", file, filename);
  else form.append("file", file);
  return request<IngestPreview>("/api/ingest/upload", { method: "POST", body: form });
}

/** Same `moduleAutoMerge` / `materials` body as `importYunxiaoWorkItems`. */
export function confirmIngestPreview(
  previewId: string,
  reportPartial?: Partial<Report>,
  options: ConfirmImportOptions = {},
) {
  const moduleAutoMerge = options.moduleAutoMerge !== false;
  return request<Report>("/api/ingest/confirm", {
    method: "POST",
    body: JSON.stringify({
      previewId,
      moduleAutoMerge,
      ...(reportPartial ? { reportPartial } : {}),
      ...(options.materials ? { materials: options.materials } : {}),
    }),
  });
}

export function cancelIngestPreview(previewId: string) {
  return request<void>("/api/ingest/cancel", {
    method: "POST",
    body: JSON.stringify({ previewId }),
  });
}

export function listReports() {
  return request<Report[]>("/api/reports");
}

export function getReport(id: string) {
  return request<Report>(`/api/reports/${encodeURIComponent(id)}`);
}

export function createReportOnServer(report: Report) {
  return request<Report>("/api/reports", {
    method: "POST",
    body: JSON.stringify(report),
  });
}

export function updateReportOnServer(id: string, report: Report) {
  return request<Report>(`/api/reports/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(report),
  });
}

export function deleteReportOnServer(id: string) {
  return request<void>(`/api/reports/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
