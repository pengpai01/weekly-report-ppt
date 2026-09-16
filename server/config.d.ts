export const PROJECT_ROOT: string;
export const SERVICE_NAME: string;
export const DEFAULT_PORT: 5174;
export const TABLE_PREFIX: "wr_";
export const REPORTS_TABLE: "wr_reports";
export const YUNXIAO_ITEMS_TABLE: "wr_yunxiao_items";
export const INGEST_RAW_TABLE: "wr_ingest_raw";
export const YUNXIAO_OPENAPI_BASE: "https://openapi-rdc.aliyuncs.com";
export const DEFAULT_YUNXIAO_PROJECT_NAME: "DNK-设备软件";
export const DEFAULT_YUNXIAO_SPACE_ID: "6230f5b04297236a20e79654d4";
export const DEFAULT_YUNXIAO_UPDATED_WITHIN_DAYS: 14;

export function assertInsideProject(target: string, label?: string): string;
export function defaultDataDir(): string;
export function listenPort(explicit?: number | string): number;
export function yunxiaoConfigFromEnv(source?: NodeJS.Dict<string>): {
  orgId: string;
  pat: string;
  projectName: string;
  spaceId: string;
  baseUrl: string;
};

export function mysqlConfigFromEnv(): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  charset: string;
  timezone: string;
  waitForConnections: boolean;
  connectionLimit: number;
  enableKeepAlive: boolean;
  connectTimeout: number;
};
export function appendServerLog(message: string, dataDir?: string): void;
