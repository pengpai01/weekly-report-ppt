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

export function yunxiaoErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.name === "AbortError") return fallback;
  if (err instanceof TypeError) {
    return "无法连接本机服务，请确认服务已启动后再试。";
  }
  const status = err instanceof Error ? (err as ApiError).status : undefined;
  const message = err instanceof Error ? err.message.trim() : "";

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

export function listYunxiaoWorkItems(updatedWithinDays = 14, init?: RequestInit) {
  const query = new URLSearchParams({ updatedWithinDays: String(updatedWithinDays) });
  return request<YunxiaoWorkItemList>(`/api/yunxiao/workitems?${query}`, init);
}

export function importYunxiaoWorkItems(itemIds: string[], reportPartial?: Partial<Report>) {
  return request<Report>("/api/yunxiao/import", {
    method: "POST",
    body: JSON.stringify({
      itemIds,
      ...(reportPartial ? { reportPartial } : {}),
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

export function confirmIngestPreview(previewId: string, reportPartial?: Partial<Report>) {
  return request<Report>("/api/ingest/confirm", {
    method: "POST",
    body: JSON.stringify({
      previewId,
      ...(reportPartial ? { reportPartial } : {}),
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
