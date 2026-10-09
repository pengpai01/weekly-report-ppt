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
import { createMemoryImageRepository, createSqlImageRepository, ensureReportImagesTable } from "./images.js";
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
  const fields = { ...input };
  delete fields.images;
  const templateType =
    fields.templateType ?? existing?.templateType ?? "weekly";
  const base = existing ?? {
    id: input.id || createId(),
    templateType,
    title: fields.title || defaultTitle(templateType),
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

  const next = {
    ...base,
    ...fields,
    id: existing?.id ?? fields.id ?? base.id,
    templateType,
    title: fields.title ?? base.title ?? defaultTitle(templateType),
    department: fields.department ?? base.department ?? "",
    date: fields.date ?? base.date ?? todayISO(),
    author: fields.author ?? base.author ?? "",
    projects: fields.projects ?? base.projects,
    issues: fields.issues ?? base.issues,
    nextWeek: fields.nextWeek ?? base.nextWeek,
    slides: fields.slides ?? base.slides ?? [],
    status: fields.status ?? base.status ?? "draft",
    createdAt: existing?.createdAt ?? fields.createdAt ?? base.createdAt,
    updatedAt: nowISO(),
  };
  delete next.images;
  return next;
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
  await ensureReportImagesTable(pool);
}

function imageApi(repo, ensure, getReport) {
  return {
    async listImages(reportId) {
      await ensure();
      return repo.list(reportId);
    },
    async putImage(reportId, image) {
      await ensure();
      const existing = await getReport(reportId);
      if (!existing) throw httpError(404, "Report not found");
      return repo.put(reportId, image, createId());
    },
    async readImage(reportId, imageId) {
      await ensure();
      return repo.read(reportId, imageId);
    },
    async deleteImage(reportId, imageId) {
      await ensure();
      return repo.delete(reportId, imageId);
    },
  };
}

export function createReportStore(options = {}) {
  const dataDir = options.dataDir ?? defaultDataDir();
  const ownsPool = !options.pool;
  const pool = options.pool ?? mysql.createPool(mysqlConfigFromEnv());
  const imageRepo = createSqlImageRepository(pool);
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

  const store = {
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
      const existing = await this.get(id);
      if (!existing) throw httpError(404, "Report not found");
      await imageRepo.removeReport(id);
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
  Object.assign(store, imageApi(imageRepo, ensure, (id) => store.get(id)));
  return store;
}

export function createMemoryReportStore() {
  /** @type {Map<string, object>} */
  const reports = new Map();
  const imageRepo = createMemoryImageRepository();

  function sortByUpdatedAtDesc(list) {
    return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  const ensure = async () => {};
  const store = {
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
      imageRepo.removeReport(id);
      reports.delete(id);
    },
    async close() {},
  };
  Object.assign(store, imageApi(imageRepo, ensure, (id) => store.get(id)));
  return store;
}
