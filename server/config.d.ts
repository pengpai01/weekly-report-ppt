export const PROJECT_ROOT: string;
export const SERVICE_NAME: string;
export const DEFAULT_PORT: 5174;
export const TABLE_PREFIX: "wr_";
export const REPORTS_TABLE: "wr_reports";

export function assertInsideProject(target: string, label?: string): string;
export function defaultDataDir(): string;
export function listenPort(explicit?: number | string): number;
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
