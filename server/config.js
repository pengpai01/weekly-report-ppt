import dotenv from "dotenv";
import { appendFileSync, mkdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Package root (deploy: E:\grok_bot). All local files stay under this tree. */
export const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

dotenv.config({ path: resolve(PROJECT_ROOT, ".env") });

export const SERVICE_NAME = process.env.SERVICE_NAME || "weekly-report-ppt";
export const DEFAULT_PORT = 5174;
export const TABLE_PREFIX = "wr_";
export const REPORTS_TABLE = "wr_reports";
export const YUNXIAO_ITEMS_TABLE = "wr_yunxiao_items";
/** Official devops/2021-06-25 OpenAPI host for PAT Bearer calls. */
export const YUNXIAO_OPENAPI_BASE = "https://openapi-rdc.aliyuncs.com";
export const DEFAULT_YUNXIAO_PROJECT_NAME = "DNK-设备软件";
/** DNK-设备软件 (CFRK) projex spaceIdentifier from live probe. */
export const DEFAULT_YUNXIAO_SPACE_ID = "6230f5b04297236a20e79654d4";
export const DEFAULT_YUNXIAO_UPDATED_WITHIN_DAYS = 14;

export function assertInsideProject(target, label = "path") {
  const resolved = resolve(target);
  const rel = relative(PROJECT_ROOT, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `${label} must stay under project root ${PROJECT_ROOT} (got ${resolved})`,
    );
  }
  return resolved;
}

export function defaultDataDir() {
  const requested = process.env.DATA_DIR
    ? resolve(PROJECT_ROOT, process.env.DATA_DIR)
    : resolve(PROJECT_ROOT, "data");
  return assertInsideProject(requested, "DATA_DIR");
}

export function listenPort(explicit) {
  const raw = explicit ?? process.env.PORT ?? DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return port;
}

export function yunxiaoConfigFromEnv(source = process.env) {
  const orgId = source.YUNXIAO_ORG_ID?.trim() ?? "";
  const pat = source.YUNXIAO_PAT?.trim() ?? "";
  const projectName =
    source.YUNXIAO_PROJECT_NAME?.trim() || DEFAULT_YUNXIAO_PROJECT_NAME;
  const spaceId = source.YUNXIAO_SPACE_ID?.trim() || DEFAULT_YUNXIAO_SPACE_ID;
  const missing = [];
  if (!orgId) missing.push("YUNXIAO_ORG_ID");
  if (!pat) missing.push("YUNXIAO_PAT");
  if (missing.length) {
    const error = new Error(
      `Missing Yunxiao config: ${missing.join(", ")}. Copy .env.example to .env and set the values. Do not commit secrets.`,
    );
    error.status = 500;
    throw error;
  }
  return {
    orgId,
    pat,
    projectName,
    spaceId,
    baseUrl: YUNXIAO_OPENAPI_BASE,
  };
}

export function mysqlConfigFromEnv() {
  const host = process.env.MYSQL_HOST?.trim();
  const user = process.env.MYSQL_USER?.trim();
  const password = process.env.MYSQL_PASSWORD;
  const database = process.env.MYSQL_DATABASE?.trim();
  const port = Number(process.env.MYSQL_PORT || 3306);

  const missing = [];
  if (!host) missing.push("MYSQL_HOST");
  if (!Number.isInteger(port) || port <= 0) missing.push("MYSQL_PORT");
  if (!database) missing.push("MYSQL_DATABASE");
  if (!user) missing.push("MYSQL_USER");
  if (password === undefined || password === "") missing.push("MYSQL_PASSWORD");

  if (missing.length) {
    const error = new Error(
      `Missing MySQL config: ${missing.join(", ")}. Copy .env.example to .env in the project root and fill in values.`,
    );
    error.status = 500;
    throw error;
  }

  return {
    host,
    port,
    user,
    password,
    database,
    charset: "utf8mb4",
    timezone: "Z",
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true,
    connectTimeout: 10_000,
  };
}

export function appendServerLog(message, dataDir = defaultDataDir()) {
  try {
    const dir = assertInsideProject(dataDir, "DATA_DIR");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "server.log"), `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    // logging must not break request handling
  }
}
