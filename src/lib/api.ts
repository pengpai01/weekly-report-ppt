import type { Report } from "../types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof body?.error === "string" ? body.error : `请求失败（${res.status}）`;
    const error = new Error(message) as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return body as T;
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
