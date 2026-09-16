export const YUNXIAO_ITEMS_TABLE: "wr_yunxiao_items";
export const YUNXIAO_OPENAPI_BASE: "https://openapi-rdc.aliyuncs.com";
export const DEFAULT_YUNXIAO_PROJECT_NAME: string;
export const DEFAULT_YUNXIAO_SPACE_ID: "6230f5b04297236a20e79654d4";
export const DEFAULT_YUNXIAO_UPDATED_WITHIN_DAYS: 14;
export const CREATE_YUNXIAO_ITEMS_SQL: string;
export const YUNXIAO_PATHS: {
  searchWorkitems(orgId: string): string;
  listSprints(orgId: string, spaceIdentifier: string): string;
  getWorkitem(orgId: string, workitemId: string): string;
};

export type YunxiaoItem = {
  id: string;
  title: string;
  category: string;
  status: string;
  module?: string | null;
  assignee?: string | null;
  sprint?: string | null;
  updatedAt: string;
  statusStageIdentifier?: string | null;
  raw?: unknown;
};

export type PublicYunxiaoItem = {
  id: string;
  title: string;
  category: string;
  status: string;
  module?: string;
  assignee?: string;
  updatedAt: string;
  sprint?: string;
};

export function yunxiaoConfigFromEnv(source?: NodeJS.Dict<string>): {
  orgId: string;
  pat: string;
  projectName: string;
  spaceId: string;
  baseUrl: string;
};

export function normalizeYunxiaoWorkitem(
  raw: Record<string, unknown> | null | undefined,
  sprintNames?: Record<string, string>,
): YunxiaoItem | null;

export function toPublicYunxiaoItem(item: YunxiaoItem): PublicYunxiaoItem;
export function classifyYunxiaoItem(item: YunxiaoItem): "projects" | "issues" | "nextWeek" | "skip";
export function mapYunxiaoItemsToReport(
  items: YunxiaoItem[],
  reportPartial?: Record<string, unknown>,
): {
  projects: { id: string; name: string; bullets: string[]; status?: string }[];
  issues: { empty: boolean; items: { id: string; text: string }[] };
  nextWeek: { id: string; projectName: string; items: string[] }[];
  [key: string]: unknown;
};

export type YunxiaoItemStore = {
  getMany(ids: string[]): Promise<YunxiaoItem[]>;
  upsertMany(items: YunxiaoItem[]): Promise<void>;
  close(): Promise<void>;
};

export function ensureYunxiaoItemsTable(pool: unknown): Promise<void>;
export function createYunxiaoItemStore(options?: { pool?: unknown }): YunxiaoItemStore;
export function createMemoryYunxiaoItemStore(): YunxiaoItemStore;
export function getDefaultYunxiaoItemStore(): YunxiaoItemStore;

export type YunxiaoClient = {
  orgId: string;
  projectName: string;
  spaceId: string;
  baseUrl: string;
  listFilteredWorkitems(updatedWithinDays?: number): Promise<YunxiaoItem[]>;
  getWorkitemsByIds(ids: string[], sprintNames?: Record<string, string>): Promise<YunxiaoItem[]>;
};

export function createYunxiaoClient(options: {
  orgId: string;
  pat: string;
  projectName?: string;
  spaceId?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): YunxiaoClient;

export function syncYunxiaoWorkitems(args: {
  client: YunxiaoClient;
  itemsStore: YunxiaoItemStore;
  updatedWithinDays?: number;
}): Promise<{ items: PublicYunxiaoItem[] }>;

export function importYunxiaoWorkitems(args: {
  reportStore: { create(input?: Record<string, unknown>): Promise<unknown> };
  itemsStore: YunxiaoItemStore;
  client?: YunxiaoClient | null;
  body: { itemIds?: unknown; reportPartial?: Record<string, unknown> };
  resolveClient?: () => YunxiaoClient;
}): Promise<unknown>;

export function parseUpdatedWithinDays(raw: string | null | undefined): number;
export function resolveYunxiaoClient(deps?: Record<string, unknown>): YunxiaoClient;
export function resolveYunxiaoItemsStore(deps?: Record<string, unknown>): YunxiaoItemStore;
