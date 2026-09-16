import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  appendServerLog,
  defaultDataDir,
  mysqlConfigFromEnv,
  REPORTS_TABLE,
  TABLE_PREFIX,
} from "./config.js";
import { ensureIngestRawTable } from "./ingest.js";
import { ensureYunxiaoItemsTable } from "./yunxiao.js";

export { defaultDataDir, REPORTS_TABLE, TABLE_PREFIX };

if (!REPORTS_TABLE.startsWith(TABLE_PREFIX)) {
  throw new Error(`Refusing to use table ${REPORTS_TABLE}; must start with ${TABLE_PREFIX}`);
}

/** Owns only wr_* tables in the connected database. Never CREATE/DROP other schemas. */
const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`${REPORTS_TABLE}\` (
  \`id\` VARCHAR(64) NOT NULL,
  \`title\` VARCHAR(255) NOT NULL DEFAULT '',
  \`template_type\` VARCHAR(32) NOT NULL DEFAULT 'weekly',
  \`department\` VARCHAR(255) NOT NULL DEFAULT '',
  \`report_date\` VARCHAR(32) NOT NULL DEFAULT '',
  \`author\` VARCHAR(255) NOT NULL DEFAULT '',
  \`projects\` JSON NOT NULL,
  \`issues\` JSON NOT NULL,
  \`next_week\` JSON NOT NULL,
  \`slides\` JSON NULL,
  \`status\` VARCHAR(32) NOT NULL DEFAULT 'draft',
  \`created_at\` DATETIME(3) NOT NULL,
  \`updated_at\` DATETIME(3) NOT NULL,
  PRIMARY KEY (\`id\`),
  KEY \`idx_wr_reports_updated_at\` (\`updated_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

function nowISO() {
  return new Date().toISOString();
}

function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function defaultTitle(templateType) {
  return templateType === "biweekly" ? "双周工作总结" : "周工作总结";
}

function emptyProject() {
  return { id: randomUUID(), name: "", bullets: [""] };
}

export function createId() {
  return randomUUID();
}

export function normalizeReport(input = {}, existing) {
  const templateType =
    input.templateType ?? existing?.templateType ?? "weekly";
  const base = existing ?? {
    id: input.id || createId(),
    templateType,
    title: input.title || defaultTitle(templateType),
    department: "",
    date: todayISO(),
    author: "",
    projects: [emptyProject()],
    issues: { empty: true, items: [] },
    nextWeek: [],
    slides: [],
    status: "draft",
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };

  return {
    ...base,
    ...input,
    id: existing?.id ?? input.id ?? base.id,
    templateType,
    title: input.title ?? base.title ?? defaultTitle(templateType),
    department: input.department ?? base.department ?? "",
    date: input.date ?? base.date ?? todayISO(),
    author: input.author ?? base.author ?? "",
    projects: input.projects ?? base.projects,
    issues: input.issues ?? base.issues,
    nextWeek: input.nextWeek ?? base.nextWeek,
    slides: input.slides ?? base.slides ?? [],
    status: input.status ?? base.status ?? "draft",
    createdAt: existing?.createdAt ?? input.createdAt ?? base.createdAt,
    updatedAt: nowISO(),
  };
}

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function toIso(value) {
  if (!value) return nowISO();
  if (value instanceof Date) return value.toISOString();
  const asDate = new Date(value);
  return Number.isNaN(asDate.getTime()) ? String(value) : asDate.toISOString();
}

function toMysqlDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

function jsonParam(value) {
  return JSON.stringify(value ?? null);
}

function rowToReport(row) {
  return {
    id: row.id,
    title: row.title,
    templateType: row.template_type,
    department: row.department,
    date: row.report_date,
    author: row.author,
    projects: parseJson(row.projects, []),
    issues: parseJson(row.issues, { empty: true, items: [] }),
    nextWeek: parseJson(row.next_week, []),
    slides: parseJson(row.slides, []),
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export async function ensureOwnTables(pool) {
  await pool.query(CREATE_TABLE_SQL);
  await ensureYunxiaoItemsTable(pool);
  await ensureIngestRawTable(pool);
}

export function createReportStore(options = {}) {
  const dataDir = options.dataDir ?? defaultDataDir();
  const ownsPool = !options.pool;
  const pool = options.pool ?? mysql.createPool(mysqlConfigFromEnv());
  let ready = null;

  async function ensure() {
    if (!ready) {
      ready = ensureOwnTables(pool).catch((err) => {
        ready = null;
        const cfg = options.pool ? { host: "pool" } : mysqlConfigFromEnv();
        const wrapped = httpError(
          500,
          `Cannot connect to MySQL at ${cfg.host}:${cfg.port ?? ""} (${cfg.database ?? ""}). ${err.message}`,
        );
        appendServerLog(wrapped.message, dataDir);
        throw wrapped;
      });
    }
    await ready;
  }

  return {
    dataDir,
    async list() {
      await ensure();
      const [rows] = await pool.query(
        `SELECT * FROM \`${REPORTS_TABLE}\` ORDER BY \`updated_at\` DESC`,
      );
      return rows.map(rowToReport);
    },
    async get(id) {
      await ensure();
      const [rows] = await pool.execute(
        `SELECT * FROM \`${REPORTS_TABLE}\` WHERE \`id\` = ? LIMIT 1`,
        [id],
      );
      return rows[0] ? rowToReport(rows[0]) : null;
    },
    async create(input = {}) {
      await ensure();
      const next = normalizeReport(input);
      try {
        await pool.execute(
          `INSERT INTO \`${REPORTS_TABLE}\` (
            \`id\`, \`title\`, \`template_type\`, \`department\`, \`report_date\`, \`author\`,
            \`projects\`, \`issues\`, \`next_week\`, \`slides\`, \`status\`, \`created_at\`, \`updated_at\`
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            next.id,
            next.title,
            next.templateType,
            next.department,
            next.date,
            next.author,
            jsonParam(next.projects),
            jsonParam(next.issues),
            jsonParam(next.nextWeek),
            jsonParam(next.slides),
            next.status,
            toMysqlDateTime(next.createdAt),
            toMysqlDateTime(next.updatedAt),
          ],
        );
      } catch (err) {
        if (err && err.code === "ER_DUP_ENTRY") {
          throw httpError(409, "Report already exists");
        }
        throw err;
      }
      return next;
    },
    async update(id, input = {}) {
      await ensure();
      const existing = await this.get(id);
      if (!existing) throw httpError(404, "Report not found");
      const next = normalizeReport(input, existing);
      const [result] = await pool.execute(
        `UPDATE \`${REPORTS_TABLE}\` SET
          \`title\` = ?, \`template_type\` = ?, \`department\` = ?, \`report_date\` = ?, \`author\` = ?,
          \`projects\` = ?, \`issues\` = ?, \`next_week\` = ?, \`slides\` = ?, \`status\` = ?, \`updated_at\` = ?
         WHERE \`id\` = ?`,
        [
          next.title,
          next.templateType,
          next.department,
          next.date,
          next.author,
          jsonParam(next.projects),
          jsonParam(next.issues),
          jsonParam(next.nextWeek),
          jsonParam(next.slides),
          next.status,
          toMysqlDateTime(next.updatedAt),
          id,
        ],
      );
      if (!result.affectedRows) throw httpError(404, "Report not found");
      return next;
    },
    async delete(id) {
      await ensure();
      const [result] = await pool.execute(
        `DELETE FROM \`${REPORTS_TABLE}\` WHERE \`id\` = ?`,
        [id],
      );
      if (!result.affectedRows) throw httpError(404, "Report not found");
    },
    async close() {
      if (ownsPool) await pool.end();
    },
  };
}

export function createMemoryReportStore() {
  /** @type {Map<string, object>} */
  const reports = new Map();

  function sortByUpdatedAtDesc(list) {
    return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  return {
    dataDir: defaultDataDir(),
    async list() {
      return sortByUpdatedAtDesc([...reports.values()]);
    },
    async get(id) {
      return reports.get(id) ?? null;
    },
    async create(input = {}) {
      const next = normalizeReport(input);
      if (reports.has(next.id)) throw httpError(409, "Report already exists");
      reports.set(next.id, next);
      return next;
    },
    async update(id, input = {}) {
      const existing = reports.get(id);
      if (!existing) throw httpError(404, "Report not found");
      const next = normalizeReport(input, existing);
      reports.set(id, next);
      return next;
    },
    async delete(id) {
      if (!reports.has(id)) throw httpError(404, "Report not found");
      reports.delete(id);
    },
    async close() {},
  };
}
