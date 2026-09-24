import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import * as XLSX from "xlsx";
import {
  INGEST_RAW_TABLE,
  mysqlConfigFromEnv,
  TABLE_PREFIX,
} from "./config.js";
import {
  applyClientMaterials,
  mapYunxiaoItemsToReport,
  resolveConfirmMaterials,
  resolveProjectName,
} from "./yunxiao.js";

export { INGEST_RAW_TABLE };

if (!INGEST_RAW_TABLE.startsWith(TABLE_PREFIX)) {
  throw new Error(
    `Refusing to use table ${INGEST_RAW_TABLE}; must start with ${TABLE_PREFIX}`,
  );
}

export const INGEST_SOURCE_UPLOAD = "upload";
export const DEFAULT_EMPTY_MODULE = "其他";
export const DEFAULT_PREVIEW_TTL_MS = 30 * 60 * 1000;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const CREATE_INGEST_RAW_SQL = `
CREATE TABLE IF NOT EXISTS \`${INGEST_RAW_TABLE}\` (
  \`id\` VARCHAR(64) NOT NULL,
  \`preview_id\` VARCHAR(64) NOT NULL,
  \`source\` VARCHAR(32) NOT NULL DEFAULT 'upload',
  \`row_no\` INT NOT NULL,
  \`payload\` JSON NOT NULL,
  \`ok\` TINYINT(1) NOT NULL,
  \`error\` VARCHAR(512) NULL,
  \`source_id\` VARCHAR(255) NULL,
  \`created_at\` DATETIME(3) NOT NULL,
  PRIMARY KEY (\`id\`),
  KEY \`idx_wr_ingest_raw_preview_id\` (\`preview_id\`),
  KEY \`idx_wr_ingest_raw_source_source_id\` (\`source\`, \`source_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const REQUIRED_HEADERS = {
  title: "事项标题",
  status: "状态",
};

const OPTIONAL_HEADERS = {
  module: "模块",
  owner: "负责人",
  detail: "详情",
  planDate: "计划日期",
  sourceId: "来源ID",
};

const HEADER_TO_FIELD = {
  [REQUIRED_HEADERS.title]: "title",
  [REQUIRED_HEADERS.status]: "status",
  [OPTIONAL_HEADERS.module]: "module",
  [OPTIONAL_HEADERS.owner]: "owner",
  [OPTIONAL_HEADERS.detail]: "detail",
  [OPTIONAL_HEADERS.planDate]: "planDate",
  [OPTIONAL_HEADERS.sourceId]: "sourceId",
};

const CRLF = Buffer.from("\r\n");
const CRLFCRLF = Buffer.from("\r\n\r\n");
const BRACKET_PREFIX = /^【([^】]+)】(.*)$/;
const BRACKET_ONLY = /^【([^】]+)】$/;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function optionalString(value) {
  if (value == null) return "";
  return String(value).trim();
}

function jsonParam(value) {
  return JSON.stringify(value ?? null);
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

function cellString(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).trim();
}

function normalizeHeader(value) {
  return cellString(value).replace(/^\uFEFF/, "").replace(/\s+/g, "");
}

export function stripBracketName(value) {
  const text = optionalString(value);
  if (!text) return "";
  const only = text.match(BRACKET_ONLY);
  return only ? only[1].trim() : text;
}

/**
 * Prefer optional 模块 when non-empty; else first 【…】 in the title; else 其他.
 * Prefix 【模块】 is stripped from the display title; mid-title brackets stay.
 */
export function resolveModuleAndTitle(title, module) {
  const text = optionalString(title);
  const project = resolveProjectName(text, module) || DEFAULT_EMPTY_MODULE;
  if (stripBracketName(module)) {
    return { project, title: text };
  }
  const prefixed = text.match(BRACKET_PREFIX);
  if (prefixed && prefixed[1].trim()) {
    const rest = prefixed[2].trim();
    return { project, title: rest || text };
  }
  return { project, title: text };
}

export function composeFullText(title, detail) {
  const t = optionalString(title);
  const d = optionalString(detail);
  if (t && d) return `${t}\n${d}`;
  return t || d;
}

export function parseCsv(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (ch === "\r") continue;
    field += ch;
  }
  if (inQuotes || field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseXlsx(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false, cellDates: true });
  const sheetName = workbook.SheetNames?.[0];
  if (!sheetName) throw httpError(400, "Workbook has no sheets");
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  return matrix.map((row) => (Array.isArray(row) ? row.map(cellString) : []));
}

export function inferSpreadsheetKind(filename, contentType) {
  const name = String(filename || "").trim().toLowerCase();
  const type = String(contentType || "").toLowerCase();
  if (name.endsWith(".xlsx")) return "xlsx";
  if (name.endsWith(".csv")) return "csv";
  if (type.includes("spreadsheetml") || type.includes("officedocument.spreadsheet")) {
    return "xlsx";
  }
  if (type.includes("text/csv") || type.includes("application/csv")) return "csv";
  throw httpError(400, "File must be .xlsx or .csv");
}

function mapHeaderRow(cells) {
  const cols = {};
  cells.forEach((cell, index) => {
    const field = HEADER_TO_FIELD[normalizeHeader(cell)];
    if (field && cols[field] == null) cols[field] = index;
  });
  return cols;
}

function findHeader(matrix) {
  for (let i = 0; i < matrix.length; i += 1) {
    const cols = mapHeaderRow(matrix[i] || []);
    if (cols.title != null && cols.status != null) {
      return { index: i, cols };
    }
  }
  return null;
}

function pick(row, cols, field) {
  if (cols[field] == null) return "";
  return cellString(row[cols[field]]);
}

function rowIsEmpty(row, cols) {
  return ["title", "status", "module", "owner", "detail", "planDate", "sourceId"].every(
    (field) => !pick(row, cols, field),
  );
}

function toPublicPreviewRow(parsed) {
  const out = {
    row: parsed.row,
    ok: parsed.ok,
    title: parsed.title,
    status: parsed.status,
  };
  if (!parsed.ok && parsed.error) out.error = parsed.error;
  if (parsed.module) out.module = parsed.module;
  if (parsed.owner) out.owner = parsed.owner;
  if (parsed.detail) out.detail = parsed.detail;
  if (parsed.planDate) out.planDate = parsed.planDate;
  if (parsed.sourceId) out.sourceId = parsed.sourceId;
  return out;
}

/**
 * Parse xlsx/csv into preview rows. Invalid rows stay with ok:false.
 */
export function parseIngestSpreadsheet(buffer, filename, contentType) {
  const kind = inferSpreadsheetKind(filename, contentType);
  const matrix =
    kind === "csv"
      ? parseCsv(Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer || ""))
      : parseXlsx(buffer);
  if (!matrix.length) {
    throw httpError(400, "File has no rows");
  }
  const header = findHeader(matrix);
  if (!header) {
    throw httpError(400, `Missing required columns: ${REQUIRED_HEADERS.title}, ${REQUIRED_HEADERS.status}`);
  }

  const parsedRows = [];
  for (let i = header.index + 1; i < matrix.length; i += 1) {
    const cells = matrix[i] || [];
    if (rowIsEmpty(cells, header.cols)) continue;
    const title = pick(cells, header.cols, "title");
    const status = pick(cells, header.cols, "status");
    const module = pick(cells, header.cols, "module");
    const owner = pick(cells, header.cols, "owner");
    const detail = pick(cells, header.cols, "detail");
    const planDate = pick(cells, header.cols, "planDate");
    const sourceId = pick(cells, header.cols, "sourceId");
    const errors = [];
    if (!title) errors.push(`${REQUIRED_HEADERS.title} is required`);
    if (!status) errors.push(`${REQUIRED_HEADERS.status} is required`);
    const resolved = resolveModuleAndTitle(title, module);
    const displayTitle = resolved.title || title;
    const fullText = composeFullText(displayTitle, detail);
    parsedRows.push({
      row: i + 1,
      ok: errors.length === 0,
      error: errors.length ? errors.join("; ") : "",
      title: displayTitle,
      status,
      module: resolved.project,
      owner,
      detail,
      planDate,
      sourceId,
      project: resolved.project,
      fullText,
    });
  }

  const summary = {
    total: parsedRows.length,
    ok: parsedRows.filter((row) => row.ok).length,
    error: parsedRows.filter((row) => !row.ok).length,
  };
  return {
    rows: parsedRows,
    summary,
    filename: String(filename || ""),
  };
}

export function ingestRowsToYunxiaoItems(rows) {
  return rows.map((row) => {
    const isBug = /bug|缺陷/i.test(row.status || "") || /bug|缺陷/i.test(row.title || "");
    return {
      id: row.sourceId || `upload-row-${row.row}`,
      title: row.fullText || row.title,
      category: isBug ? "Bug" : "Task",
      status: row.status,
      module: row.project || DEFAULT_EMPTY_MODULE,
      assignee: row.owner || null,
    };
  });
}

export function mapIngestRowsToReport(rows, reportPartial = {}, options = {}) {
  return mapYunxiaoItemsToReport(ingestRowsToYunxiaoItems(rows), reportPartial, options);
}

function dedupeKey(row, source = INGEST_SOURCE_UPLOAD) {
  if (row.sourceId) return `id:${source}:${row.sourceId}`;
  return `text:${source}:${row.project || DEFAULT_EMPTY_MODULE}:${row.fullText || row.title || ""}`;
}

export function dedupeIngestRows(okRows, existingKeys = new Set()) {
  const seen = new Set(existingKeys);
  const unique = [];
  for (const row of okRows) {
    const key = dedupeKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

export async function readRequestBuffer(req, maxBytes = MAX_UPLOAD_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) {
      throw httpError(400, `Upload exceeds ${maxBytes} bytes`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks, size);
}

export function extractMultipartFile(buffer, contentType) {
  const type = String(contentType || "");
  const match = type.match(/multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) {
    throw httpError(400, "Expected multipart/form-data with field 'file'");
  }
  const boundary = (match[1] || match[2]).trim();
  const delim = Buffer.from(`--${boundary}`);
  const parts = [];
  let pos = buffer.indexOf(delim);
  if (pos < 0) throw httpError(400, "Malformed multipart body");
  pos += delim.length;
  while (pos < buffer.length) {
    if (buffer.subarray(pos, pos + 2).toString("ascii") === "--") break;
    if (buffer.subarray(pos, pos + 2).equals(CRLF)) pos += 2;
    const next = buffer.indexOf(delim, pos);
    if (next < 0) break;
    let part = buffer.subarray(pos, next);
    if (part.length >= 2 && part.subarray(part.length - 2).equals(CRLF)) {
      part = part.subarray(0, part.length - 2);
    }
    parts.push(part);
    pos = next + delim.length;
  }

  let file = null;
  for (const part of parts) {
    const headerEnd = part.indexOf(CRLFCRLF);
    if (headerEnd < 0) continue;
    const headerText = part.subarray(0, headerEnd).toString("utf8");
    const body = part.subarray(headerEnd + 4);
    const disposition =
      headerText.split(/\r\n/).find((line) => /^content-disposition:/i.test(line)) || "";
    const name =
      /(?:^|;\s*)name="([^"]*)"/i.exec(disposition)?.[1] ||
      /(?:^|;\s*)name=([^;\s]+)/i.exec(disposition)?.[1] ||
      "";
    let filename = /filename\*=(?:UTF-8'')([^;\s]+)/i.exec(disposition)?.[1];
    if (filename) {
      try {
        filename = decodeURIComponent(filename);
      } catch {
        // keep raw
      }
    } else {
      filename =
        /filename="([^"]*)"/i.exec(disposition)?.[1] ||
        /filename=([^;\s]+)/i.exec(disposition)?.[1] ||
        "";
    }
    const partType = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() || "";
    if (name === "file") {
      file = { filename, buffer: body, contentType: partType };
    }
  }
  if (!file) {
    throw httpError(400, "Missing multipart file field 'file'");
  }
  return file;
}

export async function ensureIngestRawTable(pool) {
  await pool.query(CREATE_INGEST_RAW_SQL);
}

function rowFromDb(row) {
  const payload = parseJson(row.payload, {});
  return {
    id: row.id,
    previewId: row.preview_id,
    source: row.source,
    row: row.row_no,
    payload,
    ok: Boolean(row.ok),
    error: row.error || "",
    sourceId: optionalString(row.source_id),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    project: payload.project || DEFAULT_EMPTY_MODULE,
    fullText: payload.fullText || "",
    title: payload.title || "",
  };
}

export function createIngestRawStore(options = {}) {
  const ownsPool = !options.pool;
  const pool = options.pool ?? mysql.createPool(mysqlConfigFromEnv());
  let ready = null;

  async function ensure() {
    if (!ready) {
      ready = ensureIngestRawTable(pool).catch((err) => {
        ready = null;
        throw err;
      });
    }
    await ready;
  }

  return {
    async insertRows(rows) {
      await ensure();
      for (const row of rows) {
        await pool.execute(
          `INSERT INTO \`${INGEST_RAW_TABLE}\` (
            \`id\`, \`preview_id\`, \`source\`, \`row_no\`, \`payload\`, \`ok\`, \`error\`, \`source_id\`, \`created_at\`
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.id,
            row.previewId,
            row.source,
            row.row,
            jsonParam(row.payload),
            row.ok ? 1 : 0,
            row.error || null,
            row.sourceId || null,
            row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt || Date.now()),
          ],
        );
      }
    },
    async listByPreview(previewId) {
      await ensure();
      const [rows] = await pool.execute(
        `SELECT * FROM \`${INGEST_RAW_TABLE}\` WHERE \`preview_id\` = ? ORDER BY \`row_no\` ASC`,
        [previewId],
      );
      return rows.map(rowFromDb);
    },
    async listOkDedupeKeys(source, excludePreviewId) {
      await ensure();
      const [rows] = await pool.execute(
        `SELECT \`preview_id\`, \`source\`, \`source_id\`, \`payload\`, \`ok\`
         FROM \`${INGEST_RAW_TABLE}\`
         WHERE \`source\` = ? AND \`ok\` = 1 AND \`preview_id\` <> ?`,
        [source, excludePreviewId],
      );
      const keys = new Set();
      for (const row of rows) {
        const mapped = rowFromDb(row);
        keys.add(dedupeKey(mapped, mapped.source));
      }
      return keys;
    },
    async deleteByPreviewId(previewId) {
      await ensure();
      await pool.execute(`DELETE FROM \`${INGEST_RAW_TABLE}\` WHERE \`preview_id\` = ?`, [previewId]);
    },
    async close() {
      if (ownsPool) await pool.end();
    },
  };
}

export function createMemoryIngestRawStore() {
  /** @type {object[]} */
  const rows = [];
  return {
    async insertRows(list) {
      for (const row of list) {
        rows.push({ ...row });
      }
    },
    async listByPreview(previewId) {
      return rows.filter((row) => row.previewId === previewId).map((row) => ({ ...row }));
    },
    async listOkDedupeKeys(source, excludePreviewId) {
      const keys = new Set();
      for (const row of rows) {
        if (row.source !== source || !row.ok || row.previewId === excludePreviewId) continue;
        keys.add(dedupeKey(row, row.source));
      }
      return keys;
    },
    async deleteByPreviewId(previewId) {
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (rows[i].previewId === previewId) rows.splice(i, 1);
      }
    },
    async close() {},
  };
}

export function createMemoryPreviewStore(options = {}) {
  const ttlMs = options.ttlMs ?? DEFAULT_PREVIEW_TTL_MS;
  /** @type {Map<string, object>} */
  const map = new Map();

  function sweep(now = Date.now()) {
    for (const [id, entry] of map) {
      if (entry.expiresAt <= now) map.delete(id);
    }
  }

  return {
    async put(preview) {
      sweep();
      const entry = { ...preview, expiresAt: Date.now() + ttlMs };
      map.set(preview.id, entry);
      return entry;
    },
    async get(id) {
      sweep();
      const entry = map.get(id);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        map.delete(id);
        return null;
      }
      return entry;
    },
    async delete(id) {
      map.delete(id);
    },
  };
}

let defaultPreviewStore;
let defaultIngestStore;

export function getDefaultPreviewStore() {
  defaultPreviewStore ??= createMemoryPreviewStore();
  return defaultPreviewStore;
}

export function getDefaultIngestRawStore() {
  defaultIngestStore ??= createIngestRawStore();
  return defaultIngestStore;
}

export function resolvePreviewStore(deps = {}) {
  return deps.previewStore || getDefaultPreviewStore();
}

export function resolveIngestRawStore(deps = {}) {
  return deps.ingestStore || getDefaultIngestRawStore();
}

function requirePreviewId(body) {
  const previewId = optionalString(body?.previewId);
  if (!previewId) throw httpError(400, "previewId is required");
  return previewId;
}

export async function uploadIngestFile({ buffer, filename, contentType, previewStore }) {
  const parsed = parseIngestSpreadsheet(buffer, filename, contentType);
  const previewId = randomUUID();
  await previewStore.put({
    id: previewId,
    filename: parsed.filename,
    rows: parsed.rows,
    summary: parsed.summary,
    source: INGEST_SOURCE_UPLOAD,
  });
  return {
    previewId,
    rows: parsed.rows.map(toPublicPreviewRow),
    summary: parsed.summary,
  };
}

export async function confirmIngestPreview({ body, previewStore, ingestStore, reportStore }) {
  const previewId = requirePreviewId(body);
  // Optional: moduleAutoMerge (boolean, default true) and materials
  // { projects, issues, nextWeek } arrays. materials is stored as the draft
  // fields and skips server auto-merge. The flag is not persisted (no extras column).
  const { moduleAutoMerge, materials } = resolveConfirmMaterials(body);
  const preview = await previewStore.get(previewId);
  if (!preview) throw httpError(404, "Preview not found");

  const createdAt = new Date();
  const rawRows = preview.rows.map((row) => ({
    id: randomUUID(),
    previewId,
    source: INGEST_SOURCE_UPLOAD,
    row: row.row,
    ok: row.ok,
    error: row.error || "",
    sourceId: row.sourceId || null,
    createdAt,
    project: row.project,
    fullText: row.fullText,
    title: row.title,
    payload: {
      title: row.title,
      status: row.status,
      module: row.module,
      owner: row.owner,
      detail: row.detail,
      planDate: row.planDate,
      sourceId: row.sourceId,
      project: row.project,
      fullText: row.fullText,
      error: row.error || "",
    },
  }));
  await ingestStore.insertRows(rawRows);

  const existingKeys = await ingestStore.listOkDedupeKeys(INGEST_SOURCE_UPLOAD, previewId);
  const uniqueOk = dedupeIngestRows(
    preview.rows.filter((row) => row.ok),
    existingKeys,
  );
  const report = await reportStore.create(
    applyClientMaterials(
      mapIngestRowsToReport(uniqueOk, body.reportPartial, { moduleAutoMerge }),
      materials,
    ),
  );
  await previewStore.delete(previewId);
  return report;
}

export async function cancelIngestPreview({ body, previewStore }) {
  const previewId = requirePreviewId(body);
  const preview = await previewStore.get(previewId);
  if (!preview) throw httpError(404, "Preview not found");
  await previewStore.delete(previewId);
}
