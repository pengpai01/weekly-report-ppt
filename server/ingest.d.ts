import type { IncomingMessage } from "node:http";

export const INGEST_RAW_TABLE: "wr_ingest_raw";
export const INGEST_SOURCE_UPLOAD: "upload";
export const DEFAULT_EMPTY_MODULE: "其他";
export const DEFAULT_PREVIEW_TTL_MS: number;
export const MAX_UPLOAD_BYTES: number;
export const CREATE_INGEST_RAW_SQL: string;

export type IngestKind = "xlsx" | "csv";

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
  project: string;
  fullText: string;
};

export type IngestPreview = {
  previewId: string;
  rows: Array<Omit<IngestPreviewRow, "project" | "fullText"> & { error?: string }>;
  summary: { total: number; ok: number; error: number };
};

export type IngestRawRow = {
  id?: string;
  previewId: string;
  source: string;
  row: number;
  ok: boolean;
  error?: string;
  sourceId?: string | null;
  createdAt?: Date | string;
  project?: string;
  fullText?: string;
  title?: string;
  payload?: Record<string, unknown>;
};

export type IngestRawStore = {
  insertRows(rows: IngestRawRow[]): Promise<void>;
  listByPreview(previewId: string): Promise<IngestRawRow[]>;
  listOkDedupeKeys(source: string, excludePreviewId: string): Promise<Set<string>>;
  deleteByPreviewId(previewId: string): Promise<void>;
  close(): Promise<void>;
};

export type MappedIngestReport = {
  projects: Array<{ id: string; name: string; bullets: string[]; status?: string }>;
  issues: { empty: boolean; items: Array<{ id: string; text: string }> };
  nextWeek: Array<{ id: string; projectName: string; items: string[] }>;
  [key: string]: unknown;
};

export type IngestPreviewStore = {
  put(preview: object): Promise<object>;
  get(id: string): Promise<object | null>;
  delete(id: string): Promise<void>;
};

export function stripBracketName(value: string): string;
export function resolveModuleAndTitle(
  title: string,
  module?: string,
): { project: string; title: string };
export function composeFullText(title: string, detail?: string): string;
export function parseCsv(text: string): string[][];
export function inferSpreadsheetKind(filename?: string, contentType?: string): IngestKind;
export function parseIngestSpreadsheet(
  buffer: Buffer | string,
  filename?: string,
  contentType?: string,
): { rows: IngestPreviewRow[]; summary: IngestPreview["summary"]; filename: string };
export function ingestRowsToYunxiaoItems(rows: IngestPreviewRow[]): object[];
export function mapIngestRowsToReport(
  rows: IngestPreviewRow[],
  reportPartial?: Record<string, unknown>,
  options?: { moduleAutoMerge?: boolean; projectNameAliases?: Record<string, string> },
): MappedIngestReport;
export function dedupeIngestRows(
  okRows: IngestPreviewRow[],
  existingKeys?: Set<string>,
): IngestPreviewRow[];
export function readRequestBuffer(req: IncomingMessage, maxBytes?: number): Promise<Buffer>;
export function extractMultipartFile(
  buffer: Buffer,
  contentType?: string,
): { filename: string; buffer: Buffer; contentType: string };
export function ensureIngestRawTable(pool: unknown): Promise<void>;
export function createIngestRawStore(options?: { pool?: unknown }): IngestRawStore;
export function createMemoryIngestRawStore(): IngestRawStore;
export function createMemoryPreviewStore(options?: { ttlMs?: number }): IngestPreviewStore;
export function getDefaultPreviewStore(): IngestPreviewStore;
export function getDefaultIngestRawStore(): IngestRawStore;
export function resolvePreviewStore(deps?: { previewStore?: IngestPreviewStore }): IngestPreviewStore;
export function resolveIngestRawStore(deps?: { ingestStore?: IngestRawStore }): IngestRawStore;
export function uploadIngestFile(args: {
  buffer: Buffer;
  filename?: string;
  contentType?: string;
  previewStore: IngestPreviewStore;
}): Promise<IngestPreview>;
export function confirmIngestPreview(args: {
  body: {
    previewId?: string;
    reportPartial?: Record<string, unknown>;
    moduleAutoMerge?: boolean;
    materials?: { projects?: unknown; issues?: unknown; nextWeek?: unknown };
  };
  previewStore: IngestPreviewStore;
  ingestStore: IngestRawStore;
  reportStore: { create(input?: object): Promise<{ id: string }> };
}): Promise<{ id: string }>;
export function cancelIngestPreview(args: {
  body: { previewId?: string };
  previewStore: IngestPreviewStore;
}): Promise<void>;
