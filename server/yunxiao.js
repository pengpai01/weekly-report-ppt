import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  DEFAULT_YUNXIAO_PROJECT_NAME,
  DEFAULT_YUNXIAO_SPACE_ID,
  DEFAULT_YUNXIAO_UPDATED_WITHIN_DAYS,
  mysqlConfigFromEnv,
  TABLE_PREFIX,
  YUNXIAO_ITEMS_TABLE,
  YUNXIAO_OPENAPI_BASE,
  yunxiaoConfigFromEnv,
} from "./config.js";

export {
  DEFAULT_YUNXIAO_PROJECT_NAME,
  DEFAULT_YUNXIAO_SPACE_ID,
  DEFAULT_YUNXIAO_UPDATED_WITHIN_DAYS,
  YUNXIAO_ITEMS_TABLE,
  YUNXIAO_OPENAPI_BASE,
  yunxiaoConfigFromEnv,
};

if (!YUNXIAO_ITEMS_TABLE.startsWith(TABLE_PREFIX)) {
  throw new Error(
    `Refusing to use table ${YUNXIAO_ITEMS_TABLE}; must start with ${TABLE_PREFIX}`,
  );
}

const MAX_PAGES = 50;
const PAGE_SIZE = 200;
/** Live probe: last 14 days is ~158 Task, Req=0. Fetch Task primarily; Bug optional. */
const PRIMARY_CATEGORIES = ["Task"];
const SECONDARY_CATEGORIES = ["Bug"];

/** devops/2021-06-25 ListProjects / ListWorkitems / ListSprints / GetWorkItemInfo */
export const YUNXIAO_PATHS = {
  listProjects: (orgId) => `/organization/${orgId}/listProjects`,
  listWorkitems: (orgId) => `/organization/${orgId}/listWorkitems`,
  listSprints: (orgId) => `/organization/${orgId}/sprints/list`,
  getWorkitem: (orgId, workitemId) => `/organization/${orgId}/workitems/${workitemId}`,
};

export const CREATE_YUNXIAO_ITEMS_SQL = `
CREATE TABLE IF NOT EXISTS \`${YUNXIAO_ITEMS_TABLE}\` (
  \`id\` VARCHAR(64) NOT NULL,
  \`title\` VARCHAR(512) NULL,
  \`category\` VARCHAR(32) NULL,
  \`status\` VARCHAR(64) NULL,
  \`module\` VARCHAR(255) NULL,
  \`assignee\` VARCHAR(255) NULL,
  \`sprint\` VARCHAR(255) NULL,
  \`updated_at\` DATETIME(3) NULL,
  \`raw_json\` JSON NULL,
  \`synced_at\` DATETIME(3) NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function redact(text, pat) {
  if (!text) return "";
  let out = String(text);
  if (pat) out = out.split(pat).join("[redacted]");
  return out;
}

function optionalString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function toIsoFromYunxiao(value) {
  if (value == null || value === "") return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && String(value).trim() !== "") {
    const ms = asNumber < 1e12 ? asNumber * 1000 : asNumber;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function toMysqlDateTime(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
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

function joinUrl(base, path) {
  const root = String(base || YUNXIAO_OPENAPI_BASE).replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${root}${suffix}`;
}

function fieldName(value) {
  if (value == null) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return optionalString(value.name) || optionalString(value.displayName);
  }
  return optionalString(value);
}

function fieldId(value) {
  if (value == null) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return optionalString(value.id) || optionalString(value.identifier);
  }
  return optionalString(value);
}

function extractModule(raw) {
  if (!raw || typeof raw !== "object") return null;
  return fieldName(raw.module) || optionalString(raw.moduleName);
}

function sprintIdsOf(raw) {
  if (!raw || typeof raw !== "object") return [];
  if (Array.isArray(raw.sprint)) {
    return raw.sprint.map((entry) => fieldId(entry) || optionalString(entry)).filter(Boolean);
  }
  if (raw.sprint && typeof raw.sprint === "object") {
    const id = fieldId(raw.sprint);
    return id ? [id] : [];
  }
  const single = optionalString(raw.sprintIdentifier);
  if (!single) return [];
  return single.split(",").map((part) => part.trim()).filter(Boolean);
}

export function normalizeYunxiaoWorkitem(raw, sprintNames = {}) {
  if (!raw || typeof raw !== "object") return null;
  const id = optionalString(raw.id) || optionalString(raw.identifier);
  if (!id) return null;
  const ids = sprintIdsOf(raw);
  const sprintName =
    fieldName(raw.sprint) ||
    optionalString(raw.sprintName) ||
    ids.map((sid) => sprintNames[sid]).find(Boolean) ||
    null;
  const statusObj = raw.status && typeof raw.status === "object" ? raw.status : null;
  return {
    id,
    title: optionalString(raw.subject) || optionalString(raw.title) || "",
    category:
      fieldName(raw.workitemType) ||
      optionalString(raw.categoryIdentifier) ||
      optionalString(raw.category) ||
      "",
    status: fieldName(raw.status) || (typeof raw.status === "string" ? optionalString(raw.status) : "") || "",
    module: extractModule(raw),
    assignee: fieldName(raw.assignedTo) || (typeof raw.assignedTo === "string" ? optionalString(raw.assignedTo) : null),
    sprint: sprintName,
    updatedAt: toIsoFromYunxiao(raw.gmtModified ?? raw.updatedAt ?? raw.gmtCreate),
    statusStageIdentifier:
      optionalString(statusObj?.statusStageIdentifier) ||
      optionalString(statusObj?.stageId) ||
      optionalString(raw.statusStageIdentifier),
    raw,
  };
}

export function toPublicYunxiaoItem(item) {
  const out = {
    id: item.id,
    title: item.title || "",
    category: item.category || "",
    status: item.status || "",
    updatedAt: item.updatedAt,
  };
  if (item.module) out.module = item.module;
  if (item.assignee) out.assignee = item.assignee;
  if (item.sprint) out.sprint = item.sprint;
  return out;
}

function statusHaystack(status, stage) {
  return `${status || ""} ${stage || ""}`.toLowerCase();
}

function isCancelled(status, stage) {
  const text = statusHaystack(status, stage);
  return (
    stage === "4" ||
    /已取消|取消|won't\s*do|wont\s*do|rejected|拒绝|作废/.test(text)
  );
}

function isBlocked(status) {
  return /阻塞|已阻塞|blocked|挂起|暂停/.test(String(status || "").toLowerCase());
}

function isDone(status, stage) {
  if (stage === "3") return true;
  const text = String(status || "").trim().toLowerCase();
  if (/未完成|未关闭/.test(text)) return false;
  return /已完成|完成|已关闭|关闭|已解决|已发布|已上线|done|closed|resolved|finished|launched/.test(
    text,
  );
}

function isInProgress(status, stage) {
  const text = statusHaystack(status, stage);
  return (
    stage === "2" ||
    /进行中|处理中|开发中|实现中|修复中|in.?progress|doing|active/.test(text)
  );
}

function categoryKind(item) {
  const raw = item?.raw && typeof item.raw === "object" ? item.raw : {};
  const ident = String(
    raw.categoryIdentifier || raw.workitemType?.identifier || raw.workitemType?.id || "",
  ).toLowerCase();
  const name = String(item?.category || raw.workitemType?.name || "").toLowerCase();
  const blob = `${ident} ${name}`;
  if (ident === "bug" || name === "bug" || blob.includes("缺陷")) return "Bug";
  if (ident === "req" || name === "req" || blob.includes("需求")) return "Req";
  if (ident === "task" || name === "task" || blob.includes("任务")) return "Task";
  return ident || name || "Task";
}

export function classifyYunxiaoItem(item) {
  const kind = categoryKind(item);
  const status = item?.status || "";
  const stage = String(
    item?.statusStageIdentifier ??
      item?.raw?.status?.statusStageIdentifier ??
      item?.raw?.statusStageIdentifier ??
      "",
  );
  if (isCancelled(status, stage)) return "skip";
  if (kind === "Bug" || isBlocked(status)) return "issues";
  if (isDone(status, stage) || isInProgress(status, stage)) return "projects";
  return "nextWeek";
}

function groupKey(item) {
  return optionalString(item.module) || "未分组";
}

function projectStatusFor(items) {
  const anyInProgress = items.some((item) =>
    isInProgress(item.status, item.statusStageIdentifier ?? item.raw?.statusStageIdentifier),
  );
  return anyInProgress ? "in_progress" : "launched";
}

/**
 * Map cached Yunxiao work items into Report fields for store.create.
 * @param {object[]} items
 * @param {object} [reportPartial]
 */
export function mapYunxiaoItemsToReport(items, reportPartial = {}) {
  const projectsByModule = new Map();
  const nextWeekByModule = new Map();
  const issueItems = [];

  for (const item of items) {
    const bucket = classifyYunxiaoItem(item);
    if (bucket === "skip") continue;
    if (bucket === "issues") {
      issueItems.push({
        id: randomUUID(),
        text: item.title || item.id,
      });
      continue;
    }
    const name = groupKey(item);
    if (bucket === "projects") {
      if (!projectsByModule.has(name)) projectsByModule.set(name, []);
      projectsByModule.get(name).push(item);
      continue;
    }
    if (!nextWeekByModule.has(name)) nextWeekByModule.set(name, []);
    nextWeekByModule.get(name).push(item.title || item.id);
  }

  const projects = [...projectsByModule.entries()].map(([name, grouped]) => ({
    id: randomUUID(),
    name,
    bullets: grouped.map((item) => item.title || item.id),
    status: projectStatusFor(grouped),
  }));

  const nextWeek = [...nextWeekByModule.entries()].map(([projectName, titles]) => ({
    id: randomUUID(),
    projectName,
    items: titles,
  }));

  const mapped = {
    projects,
    issues: {
      empty: issueItems.length === 0,
      items: issueItems,
    },
    nextWeek,
  };

  return {
    ...mapped,
    ...reportPartial,
    projects: reportPartial.projects ?? mapped.projects,
    issues: reportPartial.issues ?? mapped.issues,
    nextWeek: reportPartial.nextWeek ?? mapped.nextWeek,
  };
}

function rowToItem(row) {
  const raw = parseJson(row.raw_json, {});
  return {
    id: row.id,
    title: row.title || "",
    category: row.category || "",
    status: row.status || "",
    module: optionalString(row.module),
    assignee: optionalString(row.assignee),
    sprint: optionalString(row.sprint),
    updatedAt: row.updated_at ? toIsoFromYunxiao(row.updated_at) : toIsoFromYunxiao(raw.gmtModified),
    statusStageIdentifier: optionalString(raw.statusStageIdentifier),
    raw,
  };
}

export async function ensureYunxiaoItemsTable(pool) {
  await pool.query(CREATE_YUNXIAO_ITEMS_SQL);
}

export function createYunxiaoItemStore(options = {}) {
  const ownsPool = !options.pool;
  const pool = options.pool ?? mysql.createPool(mysqlConfigFromEnv());
  let ready = null;

  async function ensure() {
    if (!ready) {
      ready = ensureYunxiaoItemsTable(pool).catch((err) => {
        ready = null;
        throw err;
      });
    }
    await ready;
  }

  return {
    async getMany(ids) {
      await ensure();
      if (!ids.length) return [];
      const placeholders = ids.map(() => "?").join(", ");
      const [rows] = await pool.execute(
        `SELECT * FROM \`${YUNXIAO_ITEMS_TABLE}\` WHERE \`id\` IN (${placeholders})`,
        ids,
      );
      const byId = new Map(rows.map((row) => [row.id, rowToItem(row)]));
      return ids.map((id) => byId.get(id)).filter(Boolean);
    },
    async upsertMany(items) {
      await ensure();
      const syncedAt = new Date();
      for (const item of items) {
        await pool.execute(
          `INSERT INTO \`${YUNXIAO_ITEMS_TABLE}\` (
            \`id\`, \`title\`, \`category\`, \`status\`, \`module\`, \`assignee\`, \`sprint\`,
            \`updated_at\`, \`raw_json\`, \`synced_at\`
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            \`title\` = VALUES(\`title\`),
            \`category\` = VALUES(\`category\`),
            \`status\` = VALUES(\`status\`),
            \`module\` = VALUES(\`module\`),
            \`assignee\` = VALUES(\`assignee\`),
            \`sprint\` = VALUES(\`sprint\`),
            \`updated_at\` = VALUES(\`updated_at\`),
            \`raw_json\` = VALUES(\`raw_json\`),
            \`synced_at\` = VALUES(\`synced_at\`)`,
          [
            item.id,
            item.title || null,
            item.category || null,
            item.status || null,
            item.module || null,
            item.assignee || null,
            item.sprint || null,
            toMysqlDateTime(item.updatedAt),
            jsonParam(item.raw ?? item),
            syncedAt,
          ],
        );
      }
    },
    async close() {
      if (ownsPool) await pool.end();
    },
  };
}

export function createMemoryYunxiaoItemStore() {
  /** @type {Map<string, object>} */
  const items = new Map();
  return {
    async getMany(ids) {
      return ids.map((id) => items.get(id)).filter(Boolean);
    },
    async upsertMany(list) {
      for (const item of list) {
        items.set(item.id, { ...item });
      }
    },
    async close() {},
  };
}

async function readYunxiaoJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { errorMsg: text.slice(0, 200) };
  }
}

function assertYunxiaoSuccess(body, pat) {
  if (body && body.success === false) {
    const msg = redact(body.errorMsg || body.errorMessage || body.errorCode || "request failed", pat);
    throw httpError(502, `Yunxiao OpenAPI request failed: ${msg}`);
  }
}

export function createYunxiaoClient(options) {
  const orgId = options.orgId;
  const pat = options.pat;
  const projectName = options.projectName || DEFAULT_YUNXIAO_PROJECT_NAME;
  const spaceId = optionalString(options.spaceId) || DEFAULT_YUNXIAO_SPACE_ID;
  const baseUrl = options.baseUrl || YUNXIAO_OPENAPI_BASE;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw httpError(500, "Yunxiao client is missing fetch");
  }

  async function request(path, query = {}, { allowNotFound = false } = {}) {
    const url = new URL(joinUrl(baseUrl, path));
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
    let response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${pat}`,
          "x-yunxiao-token": pat,
        },
      });
    } catch (err) {
      throw httpError(
        502,
        `Yunxiao OpenAPI request failed: ${redact(err?.message || "network error", pat)}`,
      );
    }

    const body = await readYunxiaoJson(response);
    if (allowNotFound && response.status === 404) return null;
    if (response.status === 401 || response.status === 403) {
      throw httpError(
        502,
        "Yunxiao authentication failed. Check YUNXIAO_PAT permissions and YUNXIAO_ORG_ID.",
      );
    }
    if (!response.ok) {
      const msg = redact(
        body.errorMsg || body.errorMessage || body.errorCode || `HTTP ${response.status}`,
        pat,
      );
      throw httpError(502, `Yunxiao OpenAPI request failed: ${msg}`);
    }
    assertYunxiaoSuccess(body, pat);
    return body;
  }

  async function paginate(path, query, listKey) {
    const collected = [];
    let nextToken = "";
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const body = await request(path, {
        ...query,
        maxResults: PAGE_SIZE,
        ...(nextToken ? { nextToken } : {}),
      });
      const chunk = Array.isArray(body[listKey]) ? body[listKey] : [];
      collected.push(...chunk);
      nextToken = optionalString(body.nextToken) || "";
      if (!nextToken || chunk.length === 0) break;
    }
    return collected;
  }

  async function listProjects() {
    return paginate(
      YUNXIAO_PATHS.listProjects(orgId),
      { category: "Project", scope: "all" },
      "projects",
    );
  }

  async function resolveProject() {
    if (spaceId) {
      return { spaceIdentifier: spaceId, name: projectName };
    }
    const projects = await listProjects();
    const wanted = projectName.trim();
    const exact = projects.find((p) => optionalString(p.name) === wanted);
    const project = exact || projects.find((p) => optionalString(p.name)?.includes(wanted));
    if (!project) {
      throw httpError(404, `Yunxiao project not found: ${wanted}`);
    }
    const spaceIdentifier = optionalString(project.identifier) || optionalString(project.id);
    if (!spaceIdentifier) {
      throw httpError(502, "Yunxiao project is missing identifier (spaceIdentifier)");
    }
    return { ...project, spaceIdentifier, name: optionalString(project.name) || wanted };
  }

  async function listSprints(spaceIdentifier) {
    try {
      return await paginate(
        YUNXIAO_PATHS.listSprints(orgId),
        { spaceType: "Project", spaceIdentifier },
        "sprints",
      );
    } catch {
      return [];
    }
  }

  async function listWorkitems(spaceIdentifier, category) {
    return paginate(
      YUNXIAO_PATHS.listWorkitems(orgId),
      {
        spaceType: "Project",
        spaceIdentifier,
        category,
        searchType: "LIST",
      },
      "workitems",
    );
  }

  async function getWorkitem(workitemId) {
    const body = await request(YUNXIAO_PATHS.getWorkitem(orgId, workitemId), {}, { allowNotFound: true });
    if (!body) return null;
    return body.workitem || body;
  }

  async function getWorkitemsByIds(ids, sprintNames = {}) {
    const found = [];
    for (const id of ids) {
      const raw = await getWorkitem(id);
      const item = normalizeYunxiaoWorkitem(raw, sprintNames);
      if (item) found.push(item);
    }
    return found;
  }

  async function listFilteredWorkitems(updatedWithinDays = DEFAULT_YUNXIAO_UPDATED_WITHIN_DAYS) {
    const project = await resolveProject();
    const sprints = await listSprints(project.spaceIdentifier);
    const sprintNames = Object.fromEntries(
      sprints
        .map((sprint) => [
          fieldId(sprint) || optionalString(sprint.identifier),
          fieldName(sprint) || optionalString(sprint.name),
        ])
        .filter(([id, name]) => id && name),
    );
    const currentSprintIds = new Set(
      sprints
        .filter((sprint) => {
          const st = (fieldName(sprint.status) || optionalString(sprint.status) || "").toUpperCase();
          return st === "DOING";
        })
        .map((sprint) => fieldId(sprint) || optionalString(sprint.identifier))
        .filter(Boolean),
    );
    const cutoff = Date.now() - Number(updatedWithinDays) * 24 * 60 * 60 * 1000;

    const rawItems = [];
    for (const category of PRIMARY_CATEGORIES) {
      rawItems.push(...(await listWorkitems(project.spaceIdentifier, category)));
    }
    for (const category of SECONDARY_CATEGORIES) {
      try {
        rawItems.push(...(await listWorkitems(project.spaceIdentifier, category)));
      } catch {
        // Bug (and other secondary categories) are optional.
      }
    }

    const seen = new Set();
    const items = [];
    for (const raw of rawItems) {
      const item = normalizeYunxiaoWorkitem(raw, sprintNames);
      if (!item || seen.has(item.id)) continue;
      const inCurrentSprint = sprintIdsOf(raw).some((id) => currentSprintIds.has(id));
      const updatedMs = new Date(item.updatedAt).getTime();
      const recentlyUpdated = Number.isFinite(updatedMs) && updatedMs >= cutoff;
      if (!inCurrentSprint && !recentlyUpdated) continue;
      seen.add(item.id);
      items.push(item);
    }
    return items;
  }

  return {
    orgId,
    projectName,
    spaceId,
    baseUrl,
    request,
    listProjects,
    resolveProject,
    listSprints,
    listWorkitems,
    getWorkitem,
    getWorkitemsByIds,
    listFilteredWorkitems,
  };
}

export async function syncYunxiaoWorkitems({ client, itemsStore, updatedWithinDays }) {
  const items = await client.listFilteredWorkitems(updatedWithinDays);
  await itemsStore.upsertMany(items);
  return { items: items.map(toPublicYunxiaoItem) };
}

export async function importYunxiaoWorkitems({
  reportStore,
  itemsStore,
  client,
  body,
  resolveClient,
}) {
  const itemIds = body?.itemIds;
  if (
    !Array.isArray(itemIds) ||
    itemIds.length === 0 ||
    itemIds.some((id) => typeof id !== "string" || !id.trim())
  ) {
    throw httpError(400, "itemIds must be a non-empty array of strings");
  }
  const ids = itemIds.map((id) => id.trim());
  let items = await itemsStore.getMany(ids);
  const missing = ids.filter((id) => !items.some((item) => item.id === id));
  if (missing.length) {
    let fetcher = client;
    if (!fetcher && typeof resolveClient === "function") {
      fetcher = resolveClient();
    }
    if (!fetcher) {
      throw httpError(
        404,
        `Yunxiao items not found: ${missing.join(", ")}. Call GET /api/yunxiao/workitems first.`,
      );
    }
    const fetched = await fetcher.getWorkitemsByIds(missing);
    if (fetched.length) await itemsStore.upsertMany(fetched);
    items = await itemsStore.getMany(ids);
  }
  const stillMissing = ids.filter((id) => !items.some((item) => item.id === id));
  if (stillMissing.length) {
    throw httpError(404, `Yunxiao items not found: ${stillMissing.join(", ")}`);
  }
  const ordered = ids.map((id) => items.find((item) => item.id === id));
  const reportInput = mapYunxiaoItemsToReport(ordered, body.reportPartial);
  return reportStore.create(reportInput);
}

export function parseUpdatedWithinDays(raw) {
  if (raw == null || raw === "") return DEFAULT_YUNXIAO_UPDATED_WITHIN_DAYS;
  const days = Number(raw);
  if (!Number.isInteger(days) || days <= 0 || days > 365) {
    throw httpError(400, "updatedWithinDays must be an integer from 1 to 365");
  }
  return days;
}

let defaultYunxiaoItems;

export function getDefaultYunxiaoItemStore() {
  defaultYunxiaoItems ??= createYunxiaoItemStore();
  return defaultYunxiaoItems;
}

export function resolveYunxiaoClient(deps = {}) {
  if (deps.yunxiaoClient) return deps.yunxiaoClient;
  const env = Object.prototype.hasOwnProperty.call(deps, "yunxiaoEnv")
    ? yunxiaoConfigFromEnv(deps.yunxiaoEnv || {})
    : yunxiaoConfigFromEnv();
  return createYunxiaoClient({
    ...env,
    fetchImpl: deps.yunxiaoFetch || globalThis.fetch,
  });
}

export function resolveYunxiaoItemsStore(deps = {}) {
  return deps.yunxiaoItems || getDefaultYunxiaoItemStore();
}
